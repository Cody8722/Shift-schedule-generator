/**
 * v2 前端入口點
 *
 * 初始化所有模組，並接線 DOM 事件。
 * 本檔案扮演原 index.html 內嵌 <script> 的角色，
 * 各功能已拆分至對應模組，這裡負責組合與驅動。
 */

// ── 工具 ──
import { escapeHtml } from './utils/escapeHtml.js';
import { debounce } from './utils/debounce.js';

// ── API ──
import { api } from './api/client.js';

// ── 狀態 ──
import {
  getAppState,
  setAppState,
  getActiveProfile,
  getGeneratedData,
  setGeneratedData,
  getEditingData,
  setEditingData,
  getHasUnsavedChanges,
  setHasUnsavedChanges,
  getCurrentScheduleName,
  setCurrentScheduleName,
} from './state/appState.js';
import {
  pushEditHistory,
  pushSettingsHistory,
  undoEdit,
  redoEdit,
  undoSettings,
  redoSettings,
  clearEditHistory,
  clearSettingsHistory,
  getHistoryLock,
  setHistoryLock,
} from './state/historyStack.js';
import {
  autoSaveDraft,
  clearDraft,
  showDraftBanner,
} from './state/draftManager.js';

// ── UI ──
import { showToast } from './ui/toast.js';
import { showInput, showConfirm } from './ui/modal.js';
import { applyTheme, currentTheme } from './ui/theme.js';

// ── Features ──
import { renderPersonnelView, exportPersonnelExcel } from './features/schedule/personnelView.js';
import { showDiffModal } from './features/schedule/diffSummary.js';

// ─────────────────────────────────────────────
// DOM 元素集合（在 DOMContentLoaded 後填入）
// ─────────────────────────────────────────────
let elements = {};

// ── 本地可編輯班表狀態 ──
let availableHolidays = [];
let activeHolidayDates = new Set();
let currentEditingPersonnelIndex = -1;
// 拖拽狀態
let draggedPerson = null;
let draggedFromCell = null;

// ─────────────────────────────────────────────
// 工具：容量狀態
// ─────────────────────────────────────────────
const updateCapacityStatus = () => {
  const el = document.getElementById('capacity-status');
  if (!el) return;
  const settings = getActiveProfile()?.settings;
  if (!settings) return;
  const capacity = (settings.personnel || []).reduce((s, p) => s + (p.maxShifts || 5), 0);
  const demand = (settings.tasks || []).reduce((s, t) => s + (t.count || 1), 0) * 5;
  const diff = capacity - demand;
  if (!capacity && !demand) { el.textContent = ''; return; }
  if (diff >= 0) {
    el.className = 'text-sm p-2 rounded-md mt-2 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    el.textContent = `容量 ${capacity} ≥ 需求 ${demand}（每週最多可排滿）`;
  } else {
    el.className = 'text-sm p-2 rounded-md mt-2 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    el.textContent = `容量 ${capacity} < 需求 ${demand}，每週缺少 ${-diff} 個班次，部分勤務將排不滿`;
  }
};

// ─────────────────────────────────────────────
// 渲染函式
// ─────────────────────────────────────────────
const renderTasks = () => {
  elements.taskList.innerHTML = '';
  const tasks = getActiveProfile()?.settings?.tasks || [];
  tasks.forEach((task, index) => {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2';
    div.innerHTML = `
      <input type="text" value="${escapeHtml(task.name)}" class="form-input flex-grow min-w-0 p-1 rounded-md" data-index="${index}" data-field="name">
      <input type="number" value="${escapeHtml(task.count)}" class="form-input w-14 p-1 rounded-md" min="1" data-index="${index}" data-field="count" title="每天需要幾人">
      <input type="number" value="${escapeHtml(task.priority || 9)}" class="form-input w-12 p-1 rounded-md text-center" min="1" max="9" data-index="${index}" data-field="priority" title="優先級（1=最優先，9=最低）">
      <button class="remove-task text-red-500 hover:text-red-700 font-bold p-1" data-index="${index}">&#x2715;</button>
    `;
    elements.taskList.appendChild(div);
  });
  updateCapacityStatus();
};

const renderPersonnel = () => {
  elements.personnelList.innerHTML = '';
  const personnel = getActiveProfile()?.settings?.personnel || [];
  personnel.forEach((person, index) => {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2';
    div.innerHTML = `
      <input type="text" value="${escapeHtml(person.name)}" class="form-input flex-grow min-w-0 p-1 rounded-md" data-index="${index}" data-field="name">
      <input type="number" value="${escapeHtml(person.maxShifts || 5)}" class="form-input w-16 p-1 rounded-md" min="1" title="每週班次上限" data-index="${index}" data-field="maxShifts">
      <button class="advanced-settings-btn text-blue-500 hover:text-blue-700 p-1" data-index="${index}">⚙️</button>
      <button class="remove-personnel text-red-500 hover:text-red-700 font-bold p-1" data-index="${index}">&#x2715;</button>
    `;
    elements.personnelList.appendChild(div);
  });
  updateCapacityStatus();
};

const renderProfileSelector = () => {
  const appState = getAppState();
  elements.profileSelect.innerHTML = '';
  Object.keys(appState.profiles).forEach((name) => {
    const option = document.createElement('option');
    option.value = option.textContent = name;
    if (name === appState.activeProfile) option.selected = true;
    elements.profileSelect.appendChild(option);
  });
  const badge = document.getElementById('active-profile-badge');
  if (badge) badge.textContent = appState.activeProfile;
};

const renderSavedSchedules = () => {
  const schedules = getActiveProfile()?.schedules;
  const scheduleNames = schedules ? Object.keys(schedules) : [];
  if (scheduleNames.length === 0) {
    elements.savedSchedulesList.innerHTML =
      '<li class="text-gray-400 dark:text-gray-500 text-center py-3 text-sm">尚無儲存的班表<br><span class="text-xs">產生班表後點擊「儲存班表」</span></li>';
    return;
  }
  elements.savedSchedulesList.innerHTML = '';
  scheduleNames.forEach((name) => {
    const li = document.createElement('li');
    li.className = 'flex justify-between items-center';
    li.innerHTML = `
      <a href="#" class="load-schedule-link hover:underline" data-name="${escapeHtml(name)}">${escapeHtml(name)}</a>
      <button class="delete-schedule-btn text-red-500 hover:text-red-700 text-xs p-1" data-name="${escapeHtml(name)}">刪除</button>
    `;
    elements.savedSchedulesList.appendChild(li);
  });
};

const renderAll = () => {
  renderProfileSelector();
  renderTasks();
  renderPersonnel();
  renderSavedSchedules();
};

// ─────────────────────────────────────────────
// 設定儲存
// ─────────────────────────────────────────────
const saveSettings = async () => {
  const activeProfile = getActiveProfile();
  if (!activeProfile) return;
  await api.put(`profiles/${getAppState().activeProfile}`, { settings: activeProfile.settings });
};

const handleSettingsChange = async (updateFn) => {
  pushSettingsHistory();
  updateFn();
  renderAll();
  await saveSettings();
  if (getGeneratedData()) {
    elements.outputContainer.style.opacity = '0.5';
    await generateFullSchedule();
    elements.outputContainer.style.opacity = '1';
  }
};

// ─────────────────────────────────────────────
// 假日UI
// ─────────────────────────────────────────────
const updateHolidayButtonText = () => {
  if (availableHolidays.length === 0) {
    elements.holidaySettingsText.textContent = '範圍內無國定假日';
    elements.holidaySettingsBtn.disabled = true;
  } else {
    elements.holidaySettingsText.textContent = `已選 ${activeHolidayDates.size} / ${availableHolidays.length} 個假日進行排休`;
    elements.holidaySettingsBtn.disabled = false;
  }
};

const updateHolidaySelectionUI = async () => {
  const startWeek = elements.startWeekInput.value;
  const numWeeks = elements.numWeeksInput.value;
  if (!startWeek || !numWeeks || parseInt(numWeeks, 10) < 1) {
    availableHolidays = [];
    activeHolidayDates = new Set();
    updateHolidayButtonText();
    return;
  }
  elements.holidaySettingsText.textContent = '正在查詢假日...';
  elements.holidaySettingsBtn.disabled = true;
  try {
    const holidays = await api.get(`holidays-in-range?startWeek=${startWeek}&numWeeks=${numWeeks}`);
    if (holidays) {
      availableHolidays = holidays;
      activeHolidayDates = new Set(holidays.map((h) => h.date));
    } else {
      availableHolidays = [];
      activeHolidayDates = new Set();
    }
  } catch (error) {
    console.error(error);
    availableHolidays = [];
    activeHolidayDates = new Set();
  } finally {
    updateHolidayButtonText();
  }
};

// ─────────────────────────────────────────────
// 班表產生
// ─────────────────────────────────────────────
const renderFillStats = (weekData) => {
  const panel = document.getElementById('fill-stats-panel');
  if (!panel) return;
  const statsMap = {};
  for (const week of weekData) {
    for (const s of week.fillStats || []) {
      if (!statsMap[s.name]) statsMap[s.name] = { priority: s.priority, needed: 0, filled: 0 };
      statsMap[s.name].needed += s.needed;
      statsMap[s.name].filled += s.filled;
    }
  }
  const names = Object.keys(statsMap);
  if (names.length === 0) { panel.classList.add('hidden'); return; }
  const allOk = names.every((n) => statsMap[n].filled === statsMap[n].needed);
  if (allOk) {
    panel.className = 'mt-4 text-sm p-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    panel.textContent = '所有勤務已排滿';
    return;
  }
  const rows = names
    .map((n) => {
      const s = statsMap[n];
      const pct = s.needed > 0 ? Math.round((s.filled / s.needed) * 100) : 100;
      const color =
        pct === 100
          ? 'text-green-700 dark:text-green-300'
          : pct >= 50
          ? 'text-yellow-700 dark:text-yellow-300'
          : 'text-red-700 dark:text-red-300';
      return `<tr class="${color}"><td class="pr-3 py-0.5">${escapeHtml(n)}</td><td class="pr-3">優先 ${s.priority}</td><td class="pr-3">${s.filled} / ${s.needed}</td><td>${pct}%</td></tr>`;
    })
    .join('');
  panel.className = 'mt-4';
  panel.innerHTML = `<p class="text-sm font-semibold mb-1">勤務填補率</p><table class="text-sm"><thead><tr class="text-muted"><th class="pr-3 text-left font-normal">勤務</th><th class="pr-3 text-left font-normal">優先級</th><th class="pr-3 text-left font-normal">填補/需求</th><th class="text-left font-normal">填補率</th></tr></thead><tbody>${rows}</tbody></table>`;
};

async function generateFullSchedule() {
  const settings = getActiveProfile().settings;
  if (!settings.personnel?.length || !settings.tasks?.length) {
    showToast('請先設定勤務與人員！', 'warning');
    return;
  }
  const startWeek = elements.startWeekInput.value;
  if (!startWeek) {
    showToast('請選擇開始週！', 'warning');
    return;
  }
  const activeHolidays = Array.from(activeHolidayDates);

  elements.generateBtn.disabled = true;
  elements.generateBtnText.classList.add('hidden');
  elements.generateSpinner.classList.remove('hidden');

  try {
    const response = await api.post('generate-schedule', {
      settings,
      startWeek,
      numWeeks: parseInt(elements.numWeeksInput.value, 10),
      activeHolidays,
    });
    if (response) {
      setGeneratedData(response.data);
      setCurrentScheduleName(null);
      displaySchedule(response.html);
      renderFillStats(response.data);
    } else {
      elements.outputContainer.classList.add('hidden');
    }
  } finally {
    elements.generateBtn.disabled = false;
    elements.generateBtnText.classList.remove('hidden');
    elements.generateSpinner.classList.add('hidden');
  }
}

function displaySchedule(scheduleHtml) {
  elements.scheduleOutput.innerHTML = scheduleHtml;
  elements.outputContainer.classList.remove('hidden');
  enableEditMode();
  const isPersonnelActive = !document.getElementById('personnel-view').classList.contains('hidden');
  if (isPersonnelActive) {
    renderPersonnelView(getEditingData() || getGeneratedData());
  }
}

// ─────────────────────────────────────────────
// 可編輯班表系統
// ─────────────────────────────────────────────
function enableEditMode() {
  if (!getGeneratedData()) return;
  setEditingData(JSON.parse(JSON.stringify(getGeneratedData())));
  setHasUnsavedChanges(false);
  clearEditHistory();
  renderEditableSchedule();
  // showEditControls 已整合在 toolbar 中，無需額外呼叫
}

function renderEditableSchedule() {
  const editingData = getEditingData();
  if (!editingData) return;

  const container = elements.scheduleOutput;
  container.innerHTML = '';
  container.classList.remove('overflow-x-auto', 'overflow-auto', 'overflow-y-auto');
  container.style.overflow = 'visible';

  const outputContainer = document.getElementById('output-container');
  if (outputContainer) outputContainer.style.overflow = 'visible';

  const toolbar = createEditToolbar();
  container.appendChild(toolbar);

  const sidebar = createPersonnelSidebar();
  const wrapper = document.createElement('div');
  wrapper.className = 'flex gap-4 items-start';
  wrapper.style.position = 'static';
  wrapper.appendChild(sidebar);

  const scheduleContainer = document.createElement('div');
  scheduleContainer.className = 'flex-1 min-w-0';
  scheduleContainer.style.overflowX = 'auto';

  editingData.forEach((weekData, weekIndex) => {
    const weekElement = createEditableWeek(weekData, weekIndex);
    scheduleContainer.appendChild(weekElement);
  });

  wrapper.appendChild(scheduleContainer);
  container.appendChild(wrapper);
}

function createEditToolbar() {
  const toolbar = document.createElement('div');
  toolbar.id = 'edit-toolbar';
  toolbar.className = 'border rounded-lg p-4 mb-4 flex items-center justify-between';
  toolbar.innerHTML = `
    <div class="flex items-center gap-4">
      <span class="edit-toolbar-label text-blue-700 font-medium">編輯模式</span>
      <span id="edit-status" class="text-sm text-gray-600"></span>
    </div>
    <div class="flex gap-2 flex-wrap">
      <button id="undo-edit-btn" title="復原 (Ctrl+Z)" disabled class="px-3 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-40 text-sm">復原</button>
      <button id="redo-edit-btn" title="重做 (Ctrl+Y)" disabled class="px-3 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-40 text-sm">重做</button>
      <button id="diff-btn" title="查看與原始班表的差異" class="px-3 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 text-sm">變更摘要</button>
      <button id="save-edits-btn" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400" disabled>儲存修改</button>
      <button id="cancel-edits-btn" class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">取消編輯</button>
      <button id="exit-edit-mode-btn" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">預覽模式</button>
    </div>
  `;

  setTimeout(() => {
    document.getElementById('save-edits-btn').addEventListener('click', saveEdits);
    document.getElementById('cancel-edits-btn').addEventListener('click', cancelEdits);
    document.getElementById('exit-edit-mode-btn').addEventListener('click', exitEditMode);
    document.getElementById('undo-edit-btn').addEventListener('click', () =>
      undoEdit(renderEditableSchedule)
    );
    document.getElementById('redo-edit-btn').addEventListener('click', () =>
      redoEdit(renderEditableSchedule)
    );
    document.getElementById('diff-btn').addEventListener('click', showDiffModal);
  }, 0);

  return toolbar;
}

function createPersonnelSidebar() {
  const sidebar = document.createElement('div');
  sidebar.id = 'edit-personnel-sidebar';
  sidebar.className = 'w-64 bg-gray-50 border border-gray-200 rounded-lg p-4';
  sidebar.style.position = 'sticky';
  sidebar.style.top = '20px';
  sidebar.style.alignSelf = 'flex-start';
  sidebar.style.maxHeight = 'calc(100vh - 40px)';
  sidebar.style.display = 'flex';
  sidebar.style.flexDirection = 'column';
  sidebar.style.overflow = 'hidden';

  const header = document.createElement('h3');
  header.className = 'font-bold mb-3 text-gray-700';
  header.textContent = '可用人員';
  header.style.flexShrink = '0';
  sidebar.appendChild(header);

  const personnelList = document.createElement('div');
  personnelList.className = 'space-y-2';
  personnelList.style.flex = '1';
  personnelList.style.overflowY = 'auto';
  personnelList.style.overflowX = 'hidden';
  personnelList.style.paddingRight = '8px';
  personnelList.style.paddingBottom = '16px';
  personnelList.style.minHeight = '0';

  const personnel = getActiveProfile().settings.personnel || [];
  personnel.forEach((person) => {
    const personElement = document.createElement('div');
    personElement.className =
      'bg-white border border-gray-300 rounded px-3 py-2 cursor-move hover:bg-blue-50 hover:border-blue-400 transition-colors';
    personElement.draggable = true;
    personElement.textContent = person.name;
    personElement.dataset.personName = person.name;
    personElement.addEventListener('dragstart', handlePersonDragStart);
    personElement.addEventListener('dragend', handlePersonDragEnd);
    personnelList.appendChild(personElement);
  });

  sidebar.appendChild(personnelList);
  return sidebar;
}

function createEditableWeek(weekData, weekIndex) {
  const { schedule, tasks, dateRange, weekDayDates, scheduleDays, color } = weekData;
  const weekDayNames = ['一', '二', '三', '四', '五'];

  const weekDiv = document.createElement('div');
  weekDiv.className = 'mb-8';
  weekDiv.id = `schedule-week-${weekIndex}`;

  const title = document.createElement('h3');
  title.className = 'text-xl font-bold mb-2';
  title.textContent = `第 ${weekIndex + 1} 週班表 (${dateRange})`;
  weekDiv.appendChild(title);

  const table = document.createElement('table');
  table.className = 'schedule-table w-full border-collapse';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const thTask = document.createElement('th');
  thTask.style.backgroundColor = color.header;
  thTask.style.color = 'white';
  thTask.textContent = '勤務地點';
  headerRow.appendChild(thTask);

  weekDayDates.forEach((date, dayIndex) => {
    const th = document.createElement('th');
    th.style.backgroundColor = color.header;
    th.style.color = 'white';
    th.innerHTML = `星期${weekDayNames[dayIndex]}<br>(${date})`;
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  tasks.forEach((task, taskIndex) => {
    const row = document.createElement('tr');

    const tdTask = document.createElement('td');
    tdTask.className = 'font-medium align-middle bg-gray-50';
    tdTask.textContent = task.name;
    row.appendChild(tdTask);

    weekDayDates.forEach((date, dayIndex) => {
      const td = document.createElement('td');
      td.className = 'align-middle p-2 border border-gray-300 min-h-[60px]';

      if (!scheduleDays[dayIndex].shouldSchedule) {
        td.classList.add('holiday-cell');
        td.textContent = scheduleDays[dayIndex].description;
      } else {
        td.classList.add('editable-cell', 'hover:bg-blue-50', 'cursor-pointer');
        td.style.position = 'relative';
        td.dataset.weekIndex = weekIndex;
        td.dataset.dayIndex = dayIndex;
        td.dataset.taskIndex = taskIndex;

        const personnelList = schedule[dayIndex][taskIndex];
        renderCellPersonnel(td, personnelList);

        td.addEventListener('dragover', handleCellDragOver);
        td.addEventListener('drop', handleCellDrop);
        td.addEventListener('dragleave', handleCellDragLeave);
        td.addEventListener('click', (e) => {
          if (!e.target.closest('.person-tag')) {
            showPersonnelDropdown(td, weekIndex, dayIndex, taskIndex);
          }
        });
      }

      row.appendChild(td);
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  weekDiv.appendChild(table);

  const statsDiv = createWeeklyStats(weekData, weekIndex);
  weekDiv.appendChild(statsDiv);

  return weekDiv;
}

function createWeeklyStats(weekData, weekIndex) {
  const { schedule } = weekData;
  const personnel = getActiveProfile().settings.personnel || [];

  const shiftCounts = {};
  personnel.forEach((person) => { shiftCounts[person.name] = 0; });

  schedule.forEach((daySchedule) => {
    daySchedule.forEach((taskPersonnel) => {
      taskPersonnel.forEach((personName) => {
        shiftCounts[personName] = (shiftCounts[personName] || 0) + 1;
      });
    });
  });

  const statsContainer = document.createElement('div');
  statsContainer.className = 'mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 weekly-stats-card';

  const title = document.createElement('div');
  title.className = 'font-semibold text-gray-700 mb-2 text-sm';
  title.textContent = '本週值勤次數統計';
  statsContainer.appendChild(title);

  const tagsContainer = document.createElement('div');
  tagsContainer.className = 'flex flex-wrap gap-2';

  personnel.forEach((person) => {
    const count = shiftCounts[person.name] || 0;
    const maxShifts = person.maxShifts || 5;
    const tag = document.createElement('div');
    tag.className = 'px-3 py-1 rounded-full text-sm font-medium';
    if (count === 0) {
      tag.className += ' bg-gray-200 text-gray-600';
    } else if (count > maxShifts) {
      tag.className += ' bg-red-100 text-red-700 border-2 border-red-400';
      tag.textContent = `${person.name}: ${count}/${maxShifts}`;
    } else if (count === maxShifts) {
      tag.className += ' bg-orange-100 text-orange-700';
    } else if (count >= maxShifts - 1) {
      tag.className += ' bg-yellow-100 text-yellow-700';
    } else {
      tag.className += ' bg-green-100 text-green-700';
    }
    if (!tag.textContent) tag.textContent = `${person.name}: ${count}/${maxShifts}`;
    tagsContainer.appendChild(tag);
  });

  Object.keys(shiftCounts).forEach((personName) => {
    const isInCurrentList = personnel.some((p) => p.name === personName);
    if (!isInCurrentList) {
      const count = shiftCounts[personName];
      const tag = document.createElement('div');
      tag.className =
        'px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-700 border border-purple-300';
      tag.textContent = `${personName}: ${count} (已刪除)`;
      tagsContainer.appendChild(tag);
    }
  });

  statsContainer.appendChild(tagsContainer);
  return statsContainer;
}

function updateWeeklyStats(weekIndex) {
  const weekElement = document.getElementById(`schedule-week-${weekIndex}`);
  if (!weekElement) return;
  const oldStats = weekElement.querySelector('.mt-3.p-3.bg-gray-50');
  if (oldStats) oldStats.remove();
  const statsDiv = createWeeklyStats(getEditingData()[weekIndex], weekIndex);
  weekElement.appendChild(statsDiv);
}

function renderCellPersonnel(cell, personnelList) {
  if (!cell || !getEditingData()) return;
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  cell.innerHTML = '';

  const weekIndex = parseInt(cell.dataset.weekIndex, 10);
  const taskIndex = parseInt(cell.dataset.taskIndex, 10);
  const editingData = getEditingData();
  if (!editingData[weekIndex]?.tasks?.[taskIndex]) return;
  const taskRequiredCount = editingData[weekIndex].tasks[taskIndex].count;
  const currentCount = personnelList.length;

  const container = document.createElement('div');
  container.className = 'flex flex-col gap-1';

  const countIndicator = document.createElement('div');
  countIndicator.className = 'text-xs font-semibold';
  if (currentCount < taskRequiredCount) {
    countIndicator.className += ' text-orange-600';
    countIndicator.textContent = `${currentCount}/${taskRequiredCount} (缺 ${taskRequiredCount - currentCount})`;
  } else if (currentCount === taskRequiredCount) {
    countIndicator.className += ' text-green-600';
    countIndicator.textContent = `${currentCount}/${taskRequiredCount} ✓`;
  } else {
    countIndicator.className += ' text-red-600';
    countIndicator.textContent = `${currentCount}/${taskRequiredCount} (超額)`;
  }
  container.appendChild(countIndicator);

  const personnelContainer = document.createElement('div');
  personnelContainer.className = 'flex flex-wrap gap-1';

  personnelList.forEach((personName, index) => {
    const tag = document.createElement('span');
    tag.className =
      'person-tag inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm cursor-move';
    tag.draggable = true;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = personName;
    tag.appendChild(nameSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-person ml-1 text-red-600 hover:text-red-800 font-bold';
    removeBtn.textContent = '×';
    removeBtn.draggable = false;
    tag.appendChild(removeBtn);

    tag.dataset.personName = personName;
    tag.dataset.personIndex = index;

    tag.addEventListener('dragstart', handleTagDragStart);
    tag.addEventListener('dragend', handlePersonDragEnd);

    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const wi = parseInt(cell.dataset.weekIndex, 10);
      const di = parseInt(cell.dataset.dayIndex, 10);
      const ti = parseInt(cell.dataset.taskIndex, 10);
      removePersonFromCell(wi, di, ti, index);
    });
    removeBtn.addEventListener('mousedown', (e) => e.stopPropagation());

    personnelContainer.appendChild(tag);
  });

  if (personnelList.length === 0) {
    const placeholder = document.createElement('span');
    placeholder.className = 'text-gray-400 text-sm';
    placeholder.textContent = '點擊選擇或拖拽人員';
    personnelContainer.appendChild(placeholder);
  }

  container.appendChild(personnelContainer);
  cell.appendChild(container);

  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(scrollX, scrollY)));
}

// ── 拖拽 ──
function canAddPersonToCell(weekIndex, dayIndex, taskIndex, personName, ignoreSameCell = false) {
  const editingData = getEditingData();
  if (!editingData?.[weekIndex]) return { canAdd: false, reason: '數據無效' };

  const personnelList = editingData[weekIndex].schedule[dayIndex][taskIndex];
  const tasks = editingData[weekIndex].tasks;

  if (personnelList.includes(personName)) return { canAdd: false, reason: '已在此勤務' };

  const taskRequiredCount = tasks[taskIndex].count;
  const currentCount = personnelList.length;

  let isDraggingFromSameCell = false;
  if (draggedFromCell) {
    const fw = parseInt(draggedFromCell.dataset.weekIndex, 10);
    const fd = parseInt(draggedFromCell.dataset.dayIndex, 10);
    const ft = parseInt(draggedFromCell.dataset.taskIndex, 10);
    isDraggingFromSameCell = fw === weekIndex && fd === dayIndex && ft === taskIndex;
  }

  if (!isDraggingFromSameCell && currentCount >= taskRequiredCount) {
    return { canAdd: false, reason: `人數已滿 (${currentCount}/${taskRequiredCount})` };
  }

  const personnelSettings = getActiveProfile().settings.personnel || [];
  const person = personnelSettings.find((p) => p.name === personName);
  if (person?.offDays?.includes(dayIndex)) {
    const weekDayNames = ['一', '二', '三', '四', '五'];
    return { canAdd: false, reason: `星期${weekDayNames[dayIndex]}固定排休` };
  }

  const allTasksThisDay = editingData[weekIndex].schedule[dayIndex];
  for (let i = 0; i < allTasksThisDay.length; i++) {
    if (i !== taskIndex && allTasksThisDay[i].includes(personName)) {
      if (ignoreSameCell && draggedFromCell) {
        const fw = parseInt(draggedFromCell.dataset.weekIndex, 10);
        const fd = parseInt(draggedFromCell.dataset.dayIndex, 10);
        const ft = parseInt(draggedFromCell.dataset.taskIndex, 10);
        if (fw === weekIndex && fd === dayIndex && ft === i) continue;
      }
      const conflictTaskName = tasks[i].name;
      return { canAdd: false, reason: `已在「${conflictTaskName}」` };
    }
  }

  return { canAdd: true, reason: '' };
}

function highlightAvailableCells(personName) {
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  document.querySelectorAll('.editable-cell').forEach((cell) => {
    const wi = parseInt(cell.dataset.weekIndex, 10);
    const di = parseInt(cell.dataset.dayIndex, 10);
    const ti = parseInt(cell.dataset.taskIndex, 10);
    const result = canAddPersonToCell(wi, di, ti, personName, true);

    cell.classList.remove('bg-green-100', 'border-green-400', 'bg-red-100', 'border-red-400', 'drop-allowed', 'drop-forbidden');

    if (result.canAdd) {
      cell.classList.add('drop-allowed');
      cell.style.border = '2px dashed #4ade80';
      cell.style.backgroundColor = 'rgba(74, 222, 128, 0.1)';
    } else {
      cell.classList.add('drop-forbidden');
      cell.style.border = '2px dashed #ef4444';
      cell.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
      cell.style.cursor = 'not-allowed';
      if (!cell.querySelector('.drop-hint')) {
        const hint = document.createElement('div');
        hint.className = 'drop-hint text-xs text-red-600 font-semibold';
        hint.style.cssText = 'position:absolute;bottom:2px;left:2px;right:2px;background:rgba(254,242,242,0.95);padding:2px 4px;border-radius:4px;z-index:10;';
        hint.textContent = `🚫 ${result.reason}`;
        cell.appendChild(hint);
      }
    }
  });
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(scrollX, scrollY)));
}

function clearAllHighlights() {
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  document.querySelectorAll('.editable-cell').forEach((cell) => {
    cell.classList.remove('bg-green-100', 'border-green-400', 'bg-red-100', 'border-red-400', 'drop-allowed', 'drop-forbidden');
    cell.style.border = '';
    cell.style.backgroundColor = '';
    cell.style.cursor = '';
    cell.querySelector('.drop-hint')?.remove();
  });
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(scrollX, scrollY)));
}

function handlePersonDragStart(e) {
  draggedPerson = e.target.dataset.personName;
  draggedFromCell = null;
  e.target.classList.add('opacity-50');
  highlightAvailableCells(draggedPerson);
}

function handlePersonDragEnd(e) {
  e.target.classList.remove('opacity-50');
  clearAllHighlights();
}

function handleTagDragStart(e) {
  draggedPerson = e.target.dataset.personName;
  draggedFromCell = e.target.closest('.editable-cell');
  e.target.classList.add('opacity-50');
  highlightAvailableCells(draggedPerson);
}

function handleCellDragOver(e) {
  const cell = e.currentTarget;
  if (cell.classList.contains('drop-forbidden')) {
    e.dataTransfer.dropEffect = 'none';
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (cell.classList.contains('drop-allowed')) {
    cell.style.backgroundColor = 'rgba(74, 222, 128, 0.3)';
    cell.style.transform = 'scale(1.02)';
    cell.style.transition = 'all 0.15s ease';
  }
}

function handleCellDragLeave(e) {
  const cell = e.currentTarget;
  if (cell.classList.contains('drop-allowed')) {
    cell.style.backgroundColor = 'rgba(74, 222, 128, 0.1)';
    cell.style.transform = '';
  }
}

function handleCellDrop(e) {
  e.preventDefault();
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  clearAllHighlights();

  const cell = e.currentTarget;
  const wi = parseInt(cell.dataset.weekIndex, 10);
  const di = parseInt(cell.dataset.dayIndex, 10);
  const ti = parseInt(cell.dataset.taskIndex, 10);

  const canAdd = canAddPersonToCell(wi, di, ti, draggedPerson, true);
  if (!canAdd.canAdd) { draggedPerson = null; draggedFromCell = null; return; }

  pushEditHistory();
  setHistoryLock(true);

  if (draggedFromCell) {
    const fw = parseInt(draggedFromCell.dataset.weekIndex, 10);
    const fd = parseInt(draggedFromCell.dataset.dayIndex, 10);
    const ft = parseInt(draggedFromCell.dataset.taskIndex, 10);
    const editingData = getEditingData();
    const personIndex = editingData[fw].schedule[fd][ft].indexOf(draggedPerson);
    if (personIndex > -1) {
      editingData[fw].schedule[fd][ft].splice(personIndex, 1);
      renderCellPersonnel(draggedFromCell, editingData[fw].schedule[fd][ft]);
      if (fw !== wi) updateWeeklyStats(fw);
    }
  }

  addPersonToCell(wi, di, ti, draggedPerson);
  setHistoryLock(false);

  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(scrollX, scrollY)));
  draggedPerson = null;
  draggedFromCell = null;
}

function addPersonToCell(weekIndex, dayIndex, taskIndex, personName) {
  if (!getHistoryLock()) pushEditHistory();
  const editingData = getEditingData();
  const personnelList = editingData[weekIndex].schedule[dayIndex][taskIndex];

  if (personnelList.includes(personName)) {
    showToast(`${personName} 已在此勤務中`, 'warning');
    return;
  }

  const allTasksThisDay = editingData[weekIndex].schedule[dayIndex];
  const tasks = editingData[weekIndex].tasks;
  for (let i = 0; i < allTasksThisDay.length; i++) {
    if (i !== taskIndex && allTasksThisDay[i].includes(personName)) {
      showToast(`排班衝突：${personName} 當天已在「${tasks[i].name}」`, 'warning', 4000);
      return;
    }
  }

  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  personnelList.push(personName);

  const cell = document.querySelector(
    `[data-week-index="${weekIndex}"][data-day-index="${dayIndex}"][data-task-index="${taskIndex}"]`
  );
  renderCellPersonnel(cell, personnelList);
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(scrollX, scrollY)));
  updateWeeklyStats(weekIndex);
  markAsModified();
}

function removePersonFromCell(weekIndex, dayIndex, taskIndex, personIndex) {
  pushEditHistory();
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  const editingData = getEditingData();
  editingData[weekIndex].schedule[dayIndex][taskIndex].splice(personIndex, 1);

  const cell = document.querySelector(
    `[data-week-index="${weekIndex}"][data-day-index="${dayIndex}"][data-task-index="${taskIndex}"]`
  );
  renderCellPersonnel(cell, editingData[weekIndex].schedule[dayIndex][taskIndex]);
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(scrollX, scrollY)));
  updateWeeklyStats(weekIndex);
  markAsModified();
}

function showPersonnelDropdown(cell, weekIndex, dayIndex, taskIndex) {
  document.querySelectorAll('.personnel-dropdown').forEach((el) => el.remove());

  const dropdown = document.createElement('div');
  dropdown.className =
    'personnel-dropdown absolute bg-white border border-gray-300 rounded-lg shadow-lg p-2 z-50';
  dropdown.style.minWidth = '200px';
  dropdown.style.maxHeight = '400px';
  dropdown.style.overflowY = 'auto';

  const editingData = getEditingData();
  const personnel = getActiveProfile().settings.personnel || [];
  const currentPersonnel = editingData[weekIndex].schedule[dayIndex][taskIndex];
  const allTasksThisDay = editingData[weekIndex].schedule[dayIndex];
  const tasks = editingData[weekIndex].tasks;
  const taskRequiredCount = tasks[taskIndex].count;
  const currentCount = currentPersonnel.length;
  const isFull = currentCount >= taskRequiredCount;

  personnel.forEach((person) => {
    const option = document.createElement('div');
    const isSelected = currentPersonnel.includes(person.name);
    const weekDayNames = ['一', '二', '三', '四', '五'];
    const isOffDay = person.offDays?.includes(dayIndex);

    let isInOtherTask = false;
    let conflictTaskName = '';
    for (let i = 0; i < allTasksThisDay.length; i++) {
      if (i !== taskIndex && allTasksThisDay[i].includes(person.name)) {
        isInOtherTask = true;
        conflictTaskName = tasks[i].name;
        break;
      }
    }

    if (isOffDay) {
      option.className = 'px-3 py-2 rounded bg-red-50 text-red-400 cursor-not-allowed';
      option.innerHTML = `<input type="checkbox" disabled class="mr-2">${person.name} <span class="text-xs">星期${weekDayNames[dayIndex]}固定排休</span>`;
    } else if (isInOtherTask) {
      option.className = 'px-3 py-2 rounded bg-gray-100 text-gray-400 cursor-not-allowed';
      option.innerHTML = `<input type="checkbox" disabled class="mr-2">${person.name} <span class="text-xs">(已在「${conflictTaskName}」)</span>`;
    } else if (isFull && !isSelected) {
      option.className = 'px-3 py-2 rounded bg-orange-50 text-orange-400 cursor-not-allowed';
      option.innerHTML = `<input type="checkbox" disabled class="mr-2">${person.name} <span class="text-xs">人數已滿 (${currentCount}/${taskRequiredCount})</span>`;
    } else {
      option.className = 'px-3 py-2 hover:bg-blue-50 cursor-pointer rounded';
      option.innerHTML = `<input type="checkbox" ${isSelected ? 'checked' : ''} class="mr-2">${person.name}`;
      option.addEventListener('click', () => {
        if (isSelected) {
          const idx = currentPersonnel.indexOf(person.name);
          removePersonFromCell(weekIndex, dayIndex, taskIndex, idx);
        } else {
          addPersonToCell(weekIndex, dayIndex, taskIndex, person.name);
        }
        dropdown.remove();
      });
    }
    dropdown.appendChild(option);
  });

  document.body.appendChild(dropdown);
  const rect = cell.getBoundingClientRect();
  const dropdownHeight = dropdown.offsetHeight;
  const spaceBelow = window.innerHeight - rect.bottom;

  dropdown.style.position = 'fixed';
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.zIndex = '9999';
  if (spaceBelow >= dropdownHeight + 10 || spaceBelow >= rect.top) {
    dropdown.style.top = `${rect.bottom + 5}px`;
  } else {
    dropdown.style.top = `${rect.top - dropdownHeight - 5}px`;
  }

  setTimeout(() => {
    document.addEventListener('click', function closeDropdown(e) {
      if (!dropdown.contains(e.target)) {
        dropdown.remove();
        document.removeEventListener('click', closeDropdown);
      }
    });
  }, 0);
}

function markAsModified() {
  setHasUnsavedChanges(true);
  const saveEditsBtn = document.getElementById('save-edits-btn');
  const editStatus = document.getElementById('edit-status');
  if (saveEditsBtn) saveEditsBtn.disabled = false;
  if (editStatus) {
    editStatus.textContent = '有未儲存的修改';
    editStatus.classList.add('text-orange-600', 'font-medium');
  }
  autoSaveDraft();
}

async function saveEdits() {
  const currentScheduleName = getCurrentScheduleName();
  const editingData = getEditingData();
  if (currentScheduleName) {
    try {
      const result = await api.post('schedules', {
        name: currentScheduleName,
        data: editingData,
        profile: getAppState().activeProfile,
      });
      if (result) {
        setGeneratedData(JSON.parse(JSON.stringify(editingData)));
        setHasUnsavedChanges(false);
        getActiveProfile().schedules[currentScheduleName] = getGeneratedData();
        const saveEditsBtn = document.getElementById('save-edits-btn');
        const editStatus = document.getElementById('edit-status');
        if (saveEditsBtn) saveEditsBtn.disabled = true;
        if (editStatus) {
          editStatus.textContent = '已儲存';
          editStatus.classList.remove('text-orange-600');
          editStatus.classList.add('text-green-600');
        }
        clearDraft();
        showToast('班表修改已儲存並同步到雲端！', 'success');
      } else {
        showToast('同步到雲端時發生錯誤，請稍後再試。', 'error');
      }
    } catch (error) {
      console.error('同步班表到雲端失敗:', error);
      showToast('同步到雲端時發生錯誤，請稍後再試。', 'error');
    }
  } else {
    setGeneratedData(JSON.parse(JSON.stringify(editingData)));
    setHasUnsavedChanges(false);
    const saveEditsBtn = document.getElementById('save-edits-btn');
    const editStatus = document.getElementById('edit-status');
    if (saveEditsBtn) saveEditsBtn.disabled = true;
    if (editStatus) {
      editStatus.textContent = '已儲存';
      editStatus.classList.remove('text-orange-600');
      editStatus.classList.add('text-green-600');
    }
    clearDraft();
    showToast('班表修改已儲存！', 'success');
  }
}

async function cancelEdits() {
  if (getHasUnsavedChanges()) {
    const ok = await showConfirm('確定要放棄所有未儲存的修改嗎？');
    if (!ok) return;
  }
  clearDraft();
  setEditingData(JSON.parse(JSON.stringify(getGeneratedData())));
  setHasUnsavedChanges(false);
  renderEditableSchedule();
}

async function exitEditMode() {
  if (getHasUnsavedChanges()) {
    const ok = await showConfirm('有未儲存的修改，確定要離開編輯模式嗎？');
    if (!ok) return;
  }
  clearDraft();
  setEditingData(null);
  setHasUnsavedChanges(false);
  draggedPerson = null;
  draggedFromCell = null;

  api.post('render-schedule', getGeneratedData()).then((response) => {
    if (response?.html) {
      elements.scheduleOutput.innerHTML = response.html;
    }
  }).catch((error) => {
    console.error('渲染班表失敗:', error);
    showToast('無法載入預覽模式，請重新整理頁面', 'error');
  });
}

// ─────────────────────────────────────────────
// 人員 Modal
// ─────────────────────────────────────────────
const openPersonnelModal = (index) => {
  currentEditingPersonnelIndex = index;
  const person = getActiveProfile().settings.personnel[index];
  elements.modalPersonnelName.textContent = person.name;
  const weekDays = ['星期一', '星期二', '星期三', '星期四', '星期五'];
  elements.offDaysContainer.innerHTML = weekDays
    .map(
      (day, dayIndex) => `
      <label class="flex items-center space-x-2">
        <input type="checkbox" class="form-checkbox rounded" value="${dayIndex}" ${person.offDays?.includes(dayIndex) ? 'checked' : ''}>
        <span>${day}</span>
      </label>`
    )
    .join('');
  const tasks = getActiveProfile().settings.tasks;
  elements.preferredTaskSelect.innerHTML =
    '<option value="">無偏好</option>' +
    tasks
      .map(
        (task) =>
          `<option value="${task.name}" ${person.preferredTask === task.name ? 'selected' : ''}>${task.name}</option>`
      )
      .join('');
  elements.personnelModal.classList.remove('hidden');
};

const closePersonnelModal = () => {
  elements.personnelModal.classList.add('hidden');
  currentEditingPersonnelIndex = -1;
};

// ─────────────────────────────────────────────
// 連線狀態
// ─────────────────────────────────────────────
const checkConnectionStatus = async () => {
  try {
    const response = await fetch('api/status');
    const data = await response.json();
    if (response.ok && data.database === 'connected') {
      elements.statusIndicator.className = 'w-3 h-3 rounded-full bg-green-500 transition-colors';
      elements.statusText.textContent = '連線狀態：良好';
    } else {
      elements.statusIndicator.className = 'w-3 h-3 rounded-full bg-yellow-400 transition-colors';
      elements.statusText.textContent = '連線狀態：資料庫異常';
    }
  } catch {
    elements.statusIndicator.className = 'w-3 h-3 rounded-full bg-red-500 transition-colors';
    elements.statusText.textContent = '連線狀態：伺服器無回應';
  }
};

// ─────────────────────────────────────────────
// 初始化
// ─────────────────────────────────────────────
const setInitialAccordionState = () => {
  const accordions = document.querySelectorAll('.accordion-item');
  if (window.innerWidth >= 1024) {
    accordions.forEach((item) => item.classList.add('active'));
  } else {
    accordions[3]?.classList.add('active');
  }
};

const initApp = async () => {
  await checkConnectionStatus();
  const data = await api.get('profiles');
  if (data?.profiles) {
    const savedProfile = sessionStorage.getItem('activeProfile');
    const activeProfile =
      savedProfile && data.profiles[savedProfile] ? savedProfile : data.activeProfile;
    sessionStorage.setItem('activeProfile', activeProfile);
    setAppState({ activeProfile, profiles: data.profiles });
    renderAll();
  }
  applyTheme(currentTheme);

  // 設定本週
  const today = new Date();
  const year = today.getFullYear();
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  elements.startWeekInput.value = `${year}-W${String(weekNo).padStart(2, '0')}`;

  debouncedUpdateHolidays();
  setInitialAccordionState();
  setInterval(checkConnectionStatus, 30000);
  document.getElementById('footer-year').textContent = new Date().getFullYear();

  // 草稿恢復
  try {
    const raw = localStorage.getItem('schedule_draft');
    if (raw) {
      const draft = JSON.parse(raw);
      if (draft.profile === getAppState().activeProfile && draft.editingData) {
        const mins = Math.round((Date.now() - draft.savedAt) / 60000);
        showDraftBanner(draft, mins, renderEditableSchedule);
      }
    }
  } catch {
    clearDraft();
  }
};

// ─────────────────────────────────────────────
// DOMContentLoaded
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  elements = {
    profileSelect: document.getElementById('profile-select'),
    newProfileBtn: document.getElementById('new-profile-btn'),
    renameProfileBtn: document.getElementById('rename-profile-btn'),
    deleteProfileBtn: document.getElementById('delete-profile-btn'),
    importProfileBtn: document.getElementById('import-profile-btn'),
    exportProfileBtn: document.getElementById('export-profile-btn'),
    profileFileInput: document.getElementById('profile-file-input'),
    taskList: document.getElementById('task-list'),
    newTaskNameInput: document.getElementById('new-task-name'),
    newTaskCountInput: document.getElementById('new-task-count'),
    addTaskBtn: document.getElementById('add-task-btn'),
    personnelList: document.getElementById('personnel-list'),
    newPersonnelNameInput: document.getElementById('new-personnel-name'),
    addPersonnelBtn: document.getElementById('add-personnel-btn'),
    startWeekInput: document.getElementById('start-week'),
    numWeeksInput: document.getElementById('num-weeks'),
    generateBtn: document.getElementById('generate-schedule'),
    generateBtnText: document.getElementById('generate-btn-text'),
    generateSpinner: document.getElementById('generate-spinner'),
    outputContainer: document.getElementById('output-container'),
    scheduleOutput: document.getElementById('schedule-output'),
    copyBtn: document.getElementById('copy-schedule'),
    exportExcelBtn: document.getElementById('export-excel'),
    exportPdfBtn: document.getElementById('export-pdf'),
    exportImagePdfBtn: document.getElementById('export-image-pdf'),
    saveScheduleBtn: document.getElementById('save-schedule-btn'),
    savedSchedulesList: document.getElementById('saved-schedules-list'),
    themeToggle: document.getElementById('theme-toggle'),
    statusContainer: document.getElementById('status-container'),
    statusIndicator: document.getElementById('status-indicator'),
    statusText: document.getElementById('status-text'),
    personnelModal: document.getElementById('personnel-modal'),
    modalPersonnelName: document.getElementById('modal-personnel-name'),
    offDaysContainer: document.getElementById('off-days-container'),
    preferredTaskSelect: document.getElementById('preferred-task-select'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalSaveBtn: document.getElementById('modal-save-btn'),
    accordionContainer: document.getElementById('accordion-container'),
    holidaySettingsBtn: document.getElementById('holiday-settings-btn'),
    holidaySettingsText: document.getElementById('holiday-settings-text'),
    holidayModal: document.getElementById('holiday-modal'),
    modalHolidayList: document.getElementById('modal-holiday-list'),
    modalHolidayCloseBtn: document.getElementById('modal-holiday-close-btn'),
    modalHolidaySaveBtn: document.getElementById('modal-holiday-save-btn'),
  };

  const debouncedUpdateHolidays = debounce(updateHolidaySelectionUI, 400);
  // 讓外層函式也可以呼叫（initApp 需要）
  window._debouncedUpdateHolidays = debouncedUpdateHolidays;

  // ── 事件綁定 ──

  // Accordion
  elements.accordionContainer.addEventListener('click', (e) => {
    const header = e.target.closest('.accordion-header');
    if (header) header.parentElement.classList.toggle('active');
  });

  // Theme
  elements.themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
  });

  // 任務
  elements.addTaskBtn.addEventListener('click', () => {
    const name = elements.newTaskNameInput.value.trim();
    const count = parseInt(elements.newTaskCountInput.value, 10) || 1;
    const priority = parseInt(document.getElementById('new-task-priority').value, 10) || 9;
    if (name) {
      handleSettingsChange(() =>
        getActiveProfile().settings.tasks.push({ name, count, priority })
      );
      elements.newTaskNameInput.value = '';
      elements.newTaskCountInput.value = '1';
      document.getElementById('new-task-priority').value = '9';
    }
  });

  elements.taskList.addEventListener('change', (e) => {
    if (e.target.matches('input')) {
      const { index, field } = e.target.dataset;
      let value =
        e.target.type === 'number' ? parseInt(e.target.value, 10) : e.target.value.trim();
      if (e.target.type === 'number' && (isNaN(value) || value < 1)) value = 1;
      if (field === 'priority' && value > 9) value = 9;
      handleSettingsChange(() => (getActiveProfile().settings.tasks[index][field] = value));
    }
  });

  elements.taskList.addEventListener('click', (e) => {
    if (e.target.matches('.remove-task')) {
      handleSettingsChange(() =>
        getActiveProfile().settings.tasks.splice(e.target.dataset.index, 1)
      );
    }
  });

  // 人員
  elements.addPersonnelBtn.addEventListener('click', () => {
    const name = elements.newPersonnelNameInput.value.trim();
    if (name) {
      handleSettingsChange(() =>
        getActiveProfile().settings.personnel.push({
          name,
          maxShifts: 5,
          offDays: [],
          preferredTask: '',
        })
      );
      elements.newPersonnelNameInput.value = '';
    }
  });

  elements.personnelList.addEventListener('change', (e) => {
    if (e.target.matches('input')) {
      const { index, field } = e.target.dataset;
      let value =
        e.target.type === 'number' ? parseInt(e.target.value, 10) : e.target.value.trim();
      if (e.target.type === 'number' && (isNaN(value) || value < 1)) value = 1;
      handleSettingsChange(() => (getActiveProfile().settings.personnel[index][field] = value));
    }
  });

  elements.personnelList.addEventListener('click', (e) => {
    if (e.target.matches('.remove-personnel')) {
      handleSettingsChange(() =>
        getActiveProfile().settings.personnel.splice(e.target.dataset.index, 1)
      );
    } else if (e.target.matches('.advanced-settings-btn')) {
      openPersonnelModal(e.target.dataset.index);
    }
  });

  elements.modalCloseBtn.addEventListener('click', closePersonnelModal);
  elements.modalSaveBtn.addEventListener('click', () => {
    if (currentEditingPersonnelIndex > -1) {
      handleSettingsChange(() => {
        const person = getActiveProfile().settings.personnel[currentEditingPersonnelIndex];
        person.offDays = Array.from(
          elements.offDaysContainer.querySelectorAll('input:checked')
        ).map((cb) => parseInt(cb.value, 10));
        person.preferredTask = elements.preferredTaskSelect.value;
      });
      closePersonnelModal();
    }
  });

  // Profile
  elements.profileSelect.addEventListener('change', async (e) => {
    if (getHasUnsavedChanges()) {
      const ok = await showConfirm('班表有未儲存的修改，切換設定檔將會遺失這些修改，確定要繼續？');
      if (!ok) { e.target.value = getAppState().activeProfile; return; }
      setHasUnsavedChanges(false);
    }
    clearEditHistory();
    clearSettingsHistory();
    const newProfileName = e.target.value;
    setAppState({ activeProfile: newProfileName });
    sessionStorage.setItem('activeProfile', newProfileName);
    renderAll();
    api.put('profiles/active', { name: newProfileName }).catch(() => {});
    setGeneratedData(null);
    setCurrentScheduleName(null);
    setEditingData(null);
    setHasUnsavedChanges(false);
    elements.outputContainer.classList.add('hidden');
  });

  elements.newProfileBtn.addEventListener('click', async () => {
    const name = await showInput('新增設定檔', '');
    if (name) {
      if (getAppState().profiles[name]) { showToast('該名稱已存在！', 'warning'); return; }
      const result = await api.post('profiles', { name });
      if (result) await initApp();
    }
  });

  elements.renameProfileBtn.addEventListener('click', async () => {
    const oldName = getAppState().activeProfile;
    const newName = await showInput(`重新命名「${oldName}」`, oldName);
    if (newName && newName !== oldName) {
      if (getAppState().profiles[newName]) { showToast('該名稱已存在！', 'warning'); return; }
      const result = await api.put(`profiles/${oldName}/rename`, { newName });
      if (result) await initApp();
    }
  });

  elements.deleteProfileBtn.addEventListener('click', async () => {
    const nameToDelete = getAppState().activeProfile;
    if (Object.keys(getAppState().profiles).length <= 1) {
      showToast('至少需保留一個設定檔！', 'warning');
      return;
    }
    const ok = await showConfirm(`確定要刪除設定檔「${nameToDelete}」嗎？此操作無法復原。`);
    if (ok) {
      const result = await api.delete(`profiles/${nameToDelete}`);
      if (result) await initApp();
    }
  });

  elements.exportProfileBtn.addEventListener('click', () => {
    const settings = getActiveProfile()?.settings;
    if (!settings) return;
    const dataToExport = { settings, schedules: getActiveProfile()?.schedules || {} };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getAppState().activeProfile}_profile.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  });

  elements.importProfileBtn.addEventListener('click', () => elements.profileFileInput.click());
  elements.profileFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (!importedData.settings?.tasks || !importedData.settings?.personnel) {
          throw new Error('檔案缺少必要的 settings 欄位');
        }
        if (await showConfirm('這將會覆蓋您目前的設定與已儲存班表，確定要匯入嗎？')) {
          const activeProfile = getActiveProfile();
          activeProfile.settings = importedData.settings;
          activeProfile.schedules = importedData.schedules || {};
          setGeneratedData(null);
          setCurrentScheduleName(null);
          setEditingData(null);
          setHasUnsavedChanges(false);
          elements.outputContainer.classList.add('hidden');
          await saveSettings();
          renderAll();
        }
      } catch (err) {
        showToast(`檔案格式錯誤: ${err.message}`, 'error', 4000);
      }
    };
    reader.readAsText(file);
  });

  // 產生班表
  elements.generateBtn.addEventListener('click', generateFullSchedule);

  // 複製
  elements.copyBtn.addEventListener('click', () => {
    const generatedData = getGeneratedData();
    if (!generatedData) return;
    let textContent = '';
    generatedData.forEach((data, index) => {
      const { schedule, tasks, dateRange, weekDayDates, scheduleDays } = data;
      textContent += `第 ${index + 1} 週班表 (${dateRange})\n`;
      textContent +=
        ['勤務地點', '星期一', '星期二', '星期三', '星期四', '星期五'].join('\t') + '\n';
      tasks.forEach((task, taskIndex) => {
        let row = `${task.name}\t`;
        row += weekDayDates
          .map((_, dayIndex) => {
            if (!scheduleDays[dayIndex].shouldSchedule) return scheduleDays[dayIndex].description;
            return schedule[dayIndex][taskIndex].join(', ');
          })
          .join('\t');
        textContent += row + '\n';
      });
      textContent += '\n';
    });
    navigator.clipboard
      .writeText(textContent)
      .then(() => showToast('班表已複製！', 'success'))
      .catch(() => showToast('複製失敗！', 'error'));
  });

  // Excel
  elements.exportExcelBtn.addEventListener('click', () => {
    const generatedData = getGeneratedData();
    if (!generatedData) return;
    const wb = window.XLSX.utils.book_new();
    generatedData.forEach((data, index) => {
      const { schedule, tasks, dateRange, weekDayDates, scheduleDays } = data;
      const header = [
        '勤務地點',
        ...weekDayDates.map(
          (date, i) => `星期${['一', '二', '三', '四', '五'][i]}\n(${date})`
        ),
      ];
      const ws_data = [header];
      tasks.forEach((task, taskIndex) => {
        const row = [task.name];
        weekDayDates.forEach((_, dayIndex) => {
          if (!scheduleDays[dayIndex].shouldSchedule) {
            row.push(scheduleDays[dayIndex].description);
          } else {
            row.push(schedule[dayIndex][taskIndex].join('\n'));
          }
        });
        ws_data.push(row);
      });
      const ws = window.XLSX.utils.aoa_to_sheet(ws_data);
      ws['!cols'] = Array(6).fill({ wch: 15 });
      window.XLSX.utils.book_append_sheet(wb, ws, `第${index + 1}週`);
    });
    window.XLSX.writeFile(wb, '班表.xlsx');
  });

  // PDF
  elements.exportPdfBtn.addEventListener('click', exportToPdf);
  elements.exportImagePdfBtn.addEventListener('click', printSchedule);

  // 儲存班表
  elements.saveScheduleBtn.addEventListener('click', async () => {
    if (!getGeneratedData()) { showToast('請先產生班表！', 'warning'); return; }
    const name = await showInput('儲存班表', '');
    if (name) {
      const result = await api.post('schedules', {
        name,
        data: getGeneratedData(),
        profile: getAppState().activeProfile,
      });
      if (result) {
        getActiveProfile().schedules[name] = getGeneratedData();
        setCurrentScheduleName(name);
        renderSavedSchedules();
        showToast('班表已儲存！', 'success');
      }
    }
  });

  // 載入/刪除已儲存班表
  elements.savedSchedulesList.addEventListener('click', async (e) => {
    e.preventDefault();
    const link = e.target.closest('.load-schedule-link');
    const btn = e.target.closest('.delete-schedule-btn');
    if (link) {
      const name = link.dataset.name;
      const scheduleData = await api.get(
        `schedules/${name}?profile=${encodeURIComponent(getAppState().activeProfile)}`
      );
      if (scheduleData) {
        setGeneratedData(scheduleData);
        setCurrentScheduleName(name);
        const response = await api.post('render-schedule', scheduleData);
        if (response?.html) displaySchedule(response.html);
      }
    } else if (btn) {
      const name = btn.dataset.name;
      const ok = await showConfirm(`確定要刪除班表「${name}」嗎？`);
      if (ok) {
        const result = await api.delete(
          `schedules/${name}?profile=${encodeURIComponent(getAppState().activeProfile)}`
        );
        if (result) {
          delete getActiveProfile().schedules[name];
          renderSavedSchedules();
        }
      }
    }
  });

  // 假日設定
  elements.holidaySettingsBtn.addEventListener('click', () => {
    if (availableHolidays.length === 0) return;
    elements.modalHolidayList.innerHTML = availableHolidays
      .map(
        (holiday) => `
      <label class="flex items-center space-x-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
        <input type="checkbox" class="form-checkbox rounded holiday-checkbox" value="${holiday.date}" ${activeHolidayDates.has(holiday.date) ? 'checked' : ''}>
        <span class="flex-grow">${holiday.name}</span>
        <span class="text-sm text-gray-500">(${holiday.date.substring(4, 6)}/${holiday.date.substring(6, 8)})</span>
      </label>`
      )
      .join('');
    elements.holidayModal.classList.remove('hidden');
  });

  elements.modalHolidayCloseBtn.addEventListener('click', () => {
    elements.holidayModal.classList.add('hidden');
  });

  elements.modalHolidaySaveBtn.addEventListener('click', () => {
    const checkedBoxes = elements.modalHolidayList.querySelectorAll('.holiday-checkbox:checked');
    activeHolidayDates = new Set(Array.from(checkedBoxes).map((cb) => cb.value));
    updateHolidayButtonText();
    elements.holidayModal.classList.add('hidden');
    if (getGeneratedData()) {
      elements.outputContainer.style.opacity = '0.5';
      generateFullSchedule().then(() => {
        elements.outputContainer.style.opacity = '1';
      });
    }
  });

  elements.startWeekInput.addEventListener('change', debouncedUpdateHolidays);
  elements.numWeeksInput.addEventListener('input', debouncedUpdateHolidays);

  document.getElementById('diff-modal-close')?.addEventListener('click', () => {
    document.getElementById('diff-modal').classList.add('hidden');
  });

  // 人員/班表 tab 切換
  const personnelExcelBtn = document.getElementById('export-personnel-excel');
  const scheduleExcelBtn = document.getElementById('export-excel');

  document.getElementById('view-schedule-btn')?.addEventListener('click', () => {
    document.getElementById('schedule-output').classList.remove('hidden');
    document.getElementById('personnel-view').classList.add('hidden');
    document.getElementById('view-schedule-btn').className =
      'px-3 py-1 rounded bg-blue-600 text-white text-xs';
    document.getElementById('view-personnel-btn').className =
      'px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs';
    scheduleExcelBtn?.classList.remove('hidden');
    personnelExcelBtn?.classList.add('hidden');
  });

  document.getElementById('view-personnel-btn')?.addEventListener('click', () => {
    renderPersonnelView(getEditingData() || getGeneratedData());
    document.getElementById('personnel-view').classList.remove('hidden');
    document.getElementById('schedule-output').classList.add('hidden');
    document.getElementById('view-personnel-btn').className =
      'px-3 py-1 rounded bg-blue-600 text-white text-xs';
    document.getElementById('view-schedule-btn').className =
      'px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs';
    scheduleExcelBtn?.classList.add('hidden');
    personnelExcelBtn?.classList.remove('hidden');
  });

  personnelExcelBtn?.addEventListener('click', exportPersonnelExcel);

  // 全域鍵盤快捷鍵
  document.addEventListener('keydown', (e) => {
    const mod = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;
    if (!mod) return;
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      getEditingData() !== null
        ? undoEdit(renderEditableSchedule)
        : undoSettings(renderAll, saveSettings);
    } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
      e.preventDefault();
      getEditingData() !== null
        ? redoEdit(renderEditableSchedule)
        : redoSettings(renderAll, saveSettings);
    }
  });

  await initApp();
});

// ─────────────────────────────────────────────
// PDF / 列印（使用全域 jsPDF/html2canvas）
// ─────────────────────────────────────────────
async function printSchedule() {
  const generatedData = getGeneratedData();
  if (!generatedData) return;
  try {
    const response = await api.post('render-schedule', generatedData);
    if (response?.html) elements.scheduleOutput.innerHTML = response.html;
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.print();
  } catch (err) {
    console.error('列印失敗:', err);
    showToast('列印失敗，請稍後再試', 'error');
  }
}

async function exportToPdf() {
  const generatedData = getGeneratedData();
  if (!generatedData) return;
  try {
    const response = await api.post('render-schedule', generatedData);
    if (response?.html) elements.scheduleOutput.innerHTML = response.html;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch (err) {
    console.error('載入預覽 HTML 失敗:', err);
    showToast('無法載入班表，請稍後再試', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const allScheduleElements = Array.from(document.querySelectorAll('[id^="schedule-week-"]'));
  const numWeeks = generatedData.length;

  let fontSize, headerFontSize, titleFontSize, padding, scaleValue;
  if (numWeeks === 1) { fontSize = 18; headerFontSize = 19; titleFontSize = 22; padding = 12; scaleValue = 1.8; }
  else if (numWeeks === 2) { fontSize = 15; headerFontSize = 16; titleFontSize = 19; padding = 10; scaleValue = 1.4; }
  else if (numWeeks <= 4) { fontSize = 14; headerFontSize = 15; titleFontSize = 17; padding = 8; scaleValue = 1.3; }
  else { fontSize = 12; headerFontSize = 13; titleFontSize = 15; padding = 6; scaleValue = 1.2; }

  const style = document.createElement('style');
  style.innerHTML = `
    .pdf-export-container { display: block; padding: ${padding}px; background: white; width: 1000px !important; min-width: 1000px !important; }
    .pdf-export-container .mb-8 { margin-bottom: ${padding}px !important; }
    .pdf-export-container h3 { font-size: ${titleFontSize}px !important; margin-bottom: ${padding / 2}px !important; font-weight: bold; }
    .pdf-export-container table { font-size: ${fontSize}px !important; width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important; }
    .pdf-export-container th, .pdf-export-container td { padding: ${padding}px !important; line-height: 1.4 !important; word-wrap: break-word !important; }
    .pdf-export-container th { font-size: ${headerFontSize}px !important; font-weight: bold !important; }
  `;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.className = 'pdf-export-container';
  allScheduleElements.forEach((el) => container.appendChild(el.cloneNode(true)));
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  try {
    const canvas = await window.html2canvas(container, {
      scale: scaleValue,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
    });

    document.body.removeChild(container);
    document.head.removeChild(style);

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfPageWidth = pdf.internal.pageSize.getWidth();
    const pdfPageHeight = pdf.internal.pageSize.getHeight();
    const imgProps = pdf.getImageProperties(imgData);
    const margin = 5;
    const availableWidth = pdfPageWidth - margin * 2;
    const availableHeight = pdfPageHeight - margin * 2;

    let scale = availableWidth / imgProps.width;
    let pdfImageWidth = availableWidth;
    let pdfImageHeight = imgProps.height * scale;

    if (pdfImageHeight > availableHeight) {
      scale = availableHeight / imgProps.height;
      pdfImageHeight = availableHeight;
      pdfImageWidth = imgProps.width * scale;
    }

    const xPosition = margin;
    const yPosition = (pdfPageHeight - pdfImageHeight) / 2;
    pdf.addImage(imgData, 'JPEG', xPosition, yPosition, pdfImageWidth, pdfImageHeight);
    pdf.save('班表.pdf');
  } catch (err) {
    console.error('html2canvas failed:', err);
    showToast('PDF 導出失敗，請稍後再試', 'error');
    if (document.body.contains(container)) document.body.removeChild(container);
    if (document.head.contains(style)) document.head.removeChild(style);
  }
}

// 修正 debouncedUpdateHolidays 在 initApp 的參照
// 因為 debouncedUpdateHolidays 定義在 DOMContentLoaded 內，
// 此處提供一個橋接讓 initApp 內可以呼叫
const debouncedUpdateHolidays = (...args) => {
  if (window._debouncedUpdateHolidays) {
    window._debouncedUpdateHolidays(...args);
  }
};
