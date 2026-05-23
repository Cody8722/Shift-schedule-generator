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
import { printSchedule, exportToPdf } from './features/schedule/pdfExport.js';

// ── Utils ──
import { updateCapacityStatus } from './utils/capacityStatus.js';
import { checkConnectionStatus } from './utils/connectionStatus.js';

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
// 渲染函式
// ─────────────────────────────────────────────
const renderTasks = () => {
  elements.taskList.innerHTML = '';
  const tasks = getActiveProfile()?.settings?.tasks || [];
  if (tasks.length === 0) {
    const placeholder = document.createElement('p');
    placeholder.className = 'text-sm text-muted task-list-placeholder';
    placeholder.textContent = '（尚未新增勤務）';
    elements.taskList.appendChild(placeholder);
  } else {
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
  }
  updateCapacityStatus();
};

const renderPersonnel = () => {
  elements.personnelList.innerHTML = '';
  const personnel = getActiveProfile()?.settings?.personnel || [];
  if (personnel.length === 0) {
    const placeholder = document.createElement('p');
    placeholder.className = 'text-sm text-muted personnel-list-placeholder';
    placeholder.textContent = '（尚未新增人員）';
    elements.personnelList.appendChild(placeholder);
  } else {
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
  }
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
      '<li class="saved-empty">尚無儲存的班表<span class="hint">產生班表後點擊「儲存班表」</span></li>';
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
  const grid = document.getElementById('fillrate-grid');
  if (!panel || !grid) return;

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

  panel.className = 'fillrate';

  grid.innerHTML = names.map((n) => {
    const s = statsMap[n];
    const pct = s.needed > 0 ? Math.round((s.filled / s.needed) * 100) : 100;
    const mod = pct === 100 ? '' : pct >= 50 ? ' warn' : ' danger';
    return `
    <div class="fillrate-card${mod}">
      <div><span class="name">${escapeHtml(n)}</span><span class="pri">優先 ${s.priority}</span></div>
      <div class="nums">${s.filled}/${s.needed} · ${pct}%</div>
      <div class="bar"><div style="width:${Math.min(pct, 100)}%"></div></div>
    </div>`;
  }).join('');
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

  document.body.classList.add('editing');
  populatePersonnelSidebar();

  editingData.forEach((weekData, weekIndex) => {
    const weekElement = createEditableWeek(weekData, weekIndex);
    container.appendChild(weekElement);
  });
}

function initEditToolbarEvents() {
  document.getElementById('save-edits-btn')?.addEventListener('click', saveEdits);
  document.getElementById('cancel-edits-btn')?.addEventListener('click', cancelEdits);
  document.getElementById('exit-edit-mode-btn')?.addEventListener('click', exitEditMode);
  document.getElementById('undo-edit-btn')?.addEventListener('click', () =>
    undoEdit(renderEditableSchedule)
  );
  document.getElementById('redo-edit-btn')?.addEventListener('click', () =>
    redoEdit(renderEditableSchedule)
  );
  document.getElementById('diff-btn')?.addEventListener('click', showDiffModal);
}

function populatePersonnelSidebar() {
  const dragList = document.getElementById('drag-list');
  if (!dragList) return;
  dragList.innerHTML = '';

  const personnel = getActiveProfile().settings.personnel || [];
  personnel.forEach((person) => {
    const card = document.createElement('div');
    card.className = 'drag-card';
    card.draggable = true;
    card.textContent = person.name;
    card.dataset.personName = person.name;
    card.addEventListener('dragstart', handlePersonDragStart);
    card.addEventListener('dragend', handlePersonDragEnd);
    dragList.appendChild(card);
  });
}

function createEditableWeek(weekData, weekIndex) {
  const { schedule, tasks, dateRange, weekDayDates, scheduleDays } = weekData;
  const weekDayNames = ['一', '二', '三', '四', '五'];

  // 計算填補率用於 week-head
  const workDays = scheduleDays.filter(d => d.shouldSchedule).length;
  const demand = tasks.reduce((s, t) => s + t.count, 0) * workDays;
  const filled = tasks.reduce((s, task, ti) =>
    s + scheduleDays.reduce((a, day, di) =>
      a + (day.shouldSchedule ? schedule[di][ti].length : 0), 0), 0);
  const pct = demand > 0 ? Math.round(filled / demand * 100) : 100;
  const fillClass = pct >= 100 ? 'ok' : 'warn';

  const weekDiv = document.createElement('div');
  weekDiv.className = 'week-block';
  weekDiv.id = `schedule-week-${weekIndex}`;

  const weekHead = document.createElement('div');
  weekHead.className = 'week-head';
  weekHead.innerHTML = `
    <div class="week-label">
      <span class="week-num">W${weekIndex + 1}</span>
      <span class="week-date">${dateRange}</span>
    </div>
    <div class="week-stats">填補 <span class="${fillClass}">${filled}/${demand}</span> · ${pct}%</div>`;
  weekDiv.appendChild(weekHead);

  const table = document.createElement('table');
  table.className = 's-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const thTask = document.createElement('th');
  thTask.style.textAlign = 'left';
  thTask.style.paddingLeft = '16px';
  thTask.textContent = '勤務';
  headerRow.appendChild(thTask);

  weekDayDates.forEach((date, dayIndex) => {
    const th = document.createElement('th');
    th.innerHTML = `<span class="dow">星期${weekDayNames[dayIndex]}</span><span class="date">${date}</span>`;
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  tasks.forEach((task, taskIndex) => {
    const row = document.createElement('tr');

    const tdTask = document.createElement('td');
    tdTask.className = 'task-cell';
    const priorityCls = `p${task.priority || 9}`;
    tdTask.innerHTML = `<span class="priority-dot ${priorityCls}"></span>${task.name}<span class="task-meta">需 ${task.count} · P${task.priority || 9}</span>`;
    row.appendChild(tdTask);

    weekDayDates.forEach((date, dayIndex) => {
      const td = document.createElement('td');

      if (!scheduleDays[dayIndex].shouldSchedule) {
        td.className = 'holiday-cell';
        td.innerHTML = `<span class="holiday-label">${scheduleDays[dayIndex].description}</span>`;
      } else {
        td.className = 'editable-cell';
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

  const statsDiv = createWeeklyStats(weekData);
  weekDiv.appendChild(statsDiv);

  return weekDiv;
}

function createWeeklyStats(weekData) {
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

  const container = document.createElement('div');
  container.className = 'week-footer';

  const title = document.createElement('div');
  title.className = 'wf-title';
  title.textContent = '本週值勤次數';
  container.appendChild(title);

  const tags = document.createElement('div');
  tags.className = 'wf-tags';

  personnel.forEach((person) => {
    const count = shiftCounts[person.name] || 0;
    const maxShifts = person.maxShifts || 5;
    const tag = document.createElement('span');
    let stateClass = 'ok';
    if (count === 0) stateClass = 'zero';
    else if (count > maxShifts) stateClass = 'over';
    else if (count === maxShifts) stateClass = 'full';
    else if (count >= maxShifts - 1) stateClass = 'near';
    tag.className = `wf-tag ${stateClass}`;
    tag.textContent = `${person.name}: ${count}/${maxShifts}`;
    tags.appendChild(tag);
  });

  Object.keys(shiftCounts).forEach((personName) => {
    if (!personnel.some((p) => p.name === personName)) {
      const count = shiftCounts[personName];
      const tag = document.createElement('span');
      tag.className = 'wf-tag ghost';
      tag.textContent = `${personName}: ${count} (已刪除)`;
      tags.appendChild(tag);
    }
  });

  container.appendChild(tags);
  return container;
}

function updateWeeklyStats(weekIndex) {
  const weekElement = document.getElementById(`schedule-week-${weekIndex}`);
  if (!weekElement) return;
  const oldStats = weekElement.querySelector('.week-footer');
  if (oldStats) oldStats.remove();
  const statsDiv = createWeeklyStats(getEditingData()[weekIndex]);
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

  // 缺/滿/超額 小指示器
  const countEl = document.createElement('div');
  countEl.style.cssText = 'font:500 10px var(--font-mono);margin-bottom:4px;';
  if (currentCount < taskRequiredCount) {
    countEl.style.color = 'var(--warn)';
    countEl.textContent = `${currentCount}/${taskRequiredCount} ✗`;
    cell.classList.add('warn-cell');
  } else {
    countEl.style.color = 'var(--success)';
    countEl.textContent = `${currentCount}/${taskRequiredCount} ✓`;
    cell.classList.remove('warn-cell');
  }
  cell.appendChild(countEl);

  const persons = document.createElement('div');
  persons.className = 'persons';

  personnelList.forEach((personName, index) => {
    const tag = document.createElement('span');
    tag.className = 'person-tag';
    tag.draggable = true;
    tag.dataset.personName = personName;
    tag.dataset.personIndex = index;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = personName;
    tag.appendChild(nameSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-person';
    removeBtn.style.cssText = 'color:var(--danger);font-weight:700;margin-left:2px;font-size:13px;line-height:1;';
    removeBtn.textContent = '×';
    removeBtn.draggable = false;
    tag.appendChild(removeBtn);

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

    persons.appendChild(tag);
  });

  if (personnelList.length === 0) {
    const placeholder = document.createElement('span');
    placeholder.className = 'person-tag unfilled';
    placeholder.textContent = '＋ 待補';
    persons.appendChild(placeholder);
  }

  cell.appendChild(persons);

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
  document.body.classList.remove('editing');
  const dragList = document.getElementById('drag-list');
  if (dragList) dragList.innerHTML = '';

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
  elements.personnelModal.classList.add('open');
};

const closePersonnelModal = () => {
  elements.personnelModal.classList.remove('open');
  currentEditingPersonnelIndex = -1;
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
      <label class="holiday-item">
        <input type="checkbox" class="holiday-checkbox" value="${holiday.date}" ${activeHolidayDates.has(holiday.date) ? 'checked' : ''}>
        <span style="flex:1">${holiday.name}</span>
        <span class="hdate">${holiday.date.substring(4, 6)}/${holiday.date.substring(6, 8)}</span>
      </label>`
      )
      .join('');
    elements.holidayModal.classList.add('open');
  });

  elements.modalHolidayCloseBtn.addEventListener('click', () => {
    elements.holidayModal.classList.remove('open');
  });

  elements.modalHolidaySaveBtn.addEventListener('click', () => {
    const checkedBoxes = elements.modalHolidayList.querySelectorAll('.holiday-checkbox:checked');
    activeHolidayDates = new Set(Array.from(checkedBoxes).map((cb) => cb.value));
    updateHolidayButtonText();
    elements.holidayModal.classList.remove('open');
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
    document.getElementById('diff-modal').classList.remove('open');
  });

  initEditToolbarEvents();

  // 人員/班表 tab 切換
  const personnelExcelBtn = document.getElementById('export-personnel-excel');
  const scheduleExcelBtn = document.getElementById('export-excel');

  document.getElementById('view-schedule-btn')?.addEventListener('click', () => {
    document.getElementById('schedule-output').classList.remove('hidden');
    document.getElementById('personnel-view').classList.add('hidden');
    document.getElementById('view-schedule-btn').className = 'active';
    document.getElementById('view-personnel-btn').className = '';
    scheduleExcelBtn?.classList.remove('hidden');
    personnelExcelBtn?.classList.add('hidden');
  });

  document.getElementById('view-personnel-btn')?.addEventListener('click', () => {
    renderPersonnelView(getEditingData() || getGeneratedData());
    document.getElementById('personnel-view').classList.remove('hidden');
    document.getElementById('schedule-output').classList.add('hidden');
    document.getElementById('view-personnel-btn').className = 'active';
    document.getElementById('view-schedule-btn').className = '';
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


// 修正 debouncedUpdateHolidays 在 initApp 的參照
// 因為 debouncedUpdateHolidays 定義在 DOMContentLoaded 內，
// 此處提供一個橋接讓 initApp 內可以呼叫
const debouncedUpdateHolidays = (...args) => {
  if (window._debouncedUpdateHolidays) {
    window._debouncedUpdateHolidays(...args);
  }
};
