import { api } from '../../api/client.js';
import {
  getActiveProfile,
  getGeneratedData,
  setGeneratedData,
  getEditingData,
  setEditingData,
  getHasUnsavedChanges,
  setHasUnsavedChanges,
  getCurrentScheduleName,
  getAppState,
} from '../../state/appState.js';
import {
  pushEditHistory,
  undoEdit,
  redoEdit,
  clearEditHistory,
  getHistoryLock,
  setHistoryLock,
} from '../../state/historyStack.js';
import { autoSaveDraft, clearDraft } from '../../state/draftManager.js';
import { showToast } from '../../ui/toast.js';
import { showConfirm } from '../../ui/modal.js';
import { showDiffModal } from './diffSummary.js';

// 拖拽狀態（模組層級）
let draggedPerson = null;
let draggedFromCell = null;

// ── 進入編輯模式 ──────────────────────────────

export const enableEditMode = () => {
  if (!getGeneratedData()) return;
  setEditingData(JSON.parse(JSON.stringify(getGeneratedData())));
  setHasUnsavedChanges(false);
  clearEditHistory();
  renderEditableSchedule();
};

// ── 重新渲染整個可編輯班表 ───────────────────

export const renderEditableSchedule = () => {
  const editingData = getEditingData();
  if (!editingData) return;

  const container = document.getElementById('schedule-output');
  if (!container) return;
  container.innerHTML = '';
  container.classList.remove('overflow-x-auto', 'overflow-auto', 'overflow-y-auto');
  container.style.overflow = 'visible';

  const outputContainer = document.getElementById('output-container');
  if (outputContainer) outputContainer.style.overflow = 'visible';

  container.appendChild(createEditToolbar());

  const sidebar = createPersonnelSidebar();
  const wrapper = document.createElement('div');
  wrapper.className = 'flex gap-4 items-start';
  wrapper.style.position = 'static';
  wrapper.appendChild(sidebar);

  const scheduleContainer = document.createElement('div');
  scheduleContainer.className = 'flex-1 min-w-0';
  scheduleContainer.style.overflowX = 'auto';
  editingData.forEach((weekData, weekIndex) => {
    scheduleContainer.appendChild(createEditableWeek(weekData, weekIndex));
  });

  wrapper.appendChild(scheduleContainer);
  container.appendChild(wrapper);
};

// ── 工具列 ────────────────────────────────────

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
    document.getElementById('undo-edit-btn').addEventListener('click', () => undoEdit(renderEditableSchedule));
    document.getElementById('redo-edit-btn').addEventListener('click', () => redoEdit(renderEditableSchedule));
    document.getElementById('diff-btn').addEventListener('click', showDiffModal);
  }, 0);
  return toolbar;
}

// ── 人員側邊欄 ────────────────────────────────

function createPersonnelSidebar() {
  const sidebar = document.createElement('div');
  sidebar.id = 'edit-personnel-sidebar';
  sidebar.className = 'w-64 bg-gray-50 border border-gray-200 rounded-lg p-4';
  Object.assign(sidebar.style, {
    position: 'sticky', top: '20px', alignSelf: 'flex-start',
    maxHeight: 'calc(100vh - 40px)', display: 'flex',
    flexDirection: 'column', overflow: 'hidden',
  });

  const header = document.createElement('h3');
  header.className = 'font-bold mb-3 text-gray-700';
  header.textContent = '可用人員';
  header.style.flexShrink = '0';
  sidebar.appendChild(header);

  const list = document.createElement('div');
  list.className = 'space-y-2';
  Object.assign(list.style, {
    flex: '1', overflowY: 'auto', overflowX: 'hidden',
    paddingRight: '8px', paddingBottom: '16px', minHeight: '0',
  });

  (getActiveProfile().settings.personnel || []).forEach((person) => {
    const el = document.createElement('div');
    el.className = 'bg-white border border-gray-300 rounded px-3 py-2 cursor-move hover:bg-blue-50 hover:border-blue-400 transition-colors';
    el.draggable = true;
    el.textContent = person.name;
    el.dataset.personName = person.name;
    el.addEventListener('dragstart', handlePersonDragStart);
    el.addEventListener('dragend', handlePersonDragEnd);
    list.appendChild(el);
  });

  sidebar.appendChild(list);
  return sidebar;
}

// ── 週別渲染 ──────────────────────────────────

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

    weekDayDates.forEach((_, dayIndex) => {
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
        renderCellPersonnel(td, schedule[dayIndex][taskIndex]);
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
  weekDiv.appendChild(createWeeklyStats(weekData));
  return weekDiv;
}

// ── 週次統計 ──────────────────────────────────

function createWeeklyStats(weekData) {
  const { schedule } = weekData;
  const personnel = getActiveProfile().settings.personnel || [];

  const shiftCounts = {};
  personnel.forEach((p) => { shiftCounts[p.name] = 0; });
  schedule.forEach((daySchedule) =>
    daySchedule.forEach((taskPersonnel) =>
      taskPersonnel.forEach((name) => { shiftCounts[name] = (shiftCounts[name] || 0) + 1; })
    )
  );

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
    if (count === 0)              tag.className += ' bg-gray-200 text-gray-600';
    else if (count > maxShifts)   { tag.className += ' bg-red-100 text-red-700 border-2 border-red-400'; tag.textContent = `${person.name}: ${count}/${maxShifts}`; }
    else if (count === maxShifts) tag.className += ' bg-orange-100 text-orange-700';
    else if (count >= maxShifts - 1) tag.className += ' bg-yellow-100 text-yellow-700';
    else                          tag.className += ' bg-green-100 text-green-700';
    if (!tag.textContent) tag.textContent = `${person.name}: ${count}/${maxShifts}`;
    tagsContainer.appendChild(tag);
  });

  Object.keys(shiftCounts).forEach((personName) => {
    if (!personnel.some((p) => p.name === personName)) {
      const tag = document.createElement('div');
      tag.className = 'px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-700 border border-purple-300';
      tag.textContent = `${personName}: ${shiftCounts[personName]} (已刪除)`;
      tagsContainer.appendChild(tag);
    }
  });

  statsContainer.appendChild(tagsContainer);
  return statsContainer;
}

function updateWeeklyStats(weekIndex) {
  const weekElement = document.getElementById(`schedule-week-${weekIndex}`);
  if (!weekElement) return;
  weekElement.querySelector('.weekly-stats-card')?.remove();
  weekElement.appendChild(createWeeklyStats(getEditingData()[weekIndex]));
}

// ── 儲存格人員渲染 ────────────────────────────

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
    tag.className = 'person-tag inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm cursor-move';
    tag.draggable = true;
    tag.dataset.personName = personName;
    tag.dataset.personIndex = index;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = personName;
    tag.appendChild(nameSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-person ml-1 text-red-600 hover:text-red-800 font-bold';
    removeBtn.textContent = '×';
    removeBtn.draggable = false;
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      removePersonFromCell(
        parseInt(cell.dataset.weekIndex, 10),
        parseInt(cell.dataset.dayIndex, 10),
        parseInt(cell.dataset.taskIndex, 10),
        index
      );
    });
    removeBtn.addEventListener('mousedown', (e) => e.stopPropagation());

    tag.appendChild(removeBtn);
    tag.addEventListener('dragstart', handleTagDragStart);
    tag.addEventListener('dragend', handlePersonDragEnd);
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

// ── 拖拽邏輯 ──────────────────────────────────

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

  const person = (getActiveProfile().settings.personnel || []).find((p) => p.name === personName);
  if (person?.offDays?.includes(dayIndex)) {
    return { canAdd: false, reason: `星期${'一二三四五'[dayIndex]}固定排休` };
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
      return { canAdd: false, reason: `已在「${tasks[i].name}」` };
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
  if (cell.classList.contains('drop-forbidden')) { e.dataTransfer.dropEffect = 'none'; return; }
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

  if (!canAddPersonToCell(wi, di, ti, draggedPerson, true).canAdd) {
    draggedPerson = null; draggedFromCell = null; return;
  }

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

// ── 人員增刪 ──────────────────────────────────

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

// ── 人員下拉選單 ──────────────────────────────

function showPersonnelDropdown(cell, weekIndex, dayIndex, taskIndex) {
  document.querySelectorAll('.personnel-dropdown').forEach((el) => el.remove());

  const dropdown = document.createElement('div');
  dropdown.className = 'personnel-dropdown absolute bg-white border border-gray-300 rounded-lg shadow-lg p-2 z-50';
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
      option.innerHTML = `<input type="checkbox" disabled class="mr-2">${person.name} <span class="text-xs">星期${'一二三四五'[dayIndex]}固定排休</span>`;
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
          removePersonFromCell(weekIndex, dayIndex, taskIndex, currentPersonnel.indexOf(person.name));
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
  dropdown.style.top = (spaceBelow >= dropdownHeight + 10 || spaceBelow >= rect.top)
    ? `${rect.bottom + 5}px`
    : `${rect.top - dropdownHeight - 5}px`;

  setTimeout(() => {
    document.addEventListener('click', function closeDropdown(e) {
      if (!dropdown.contains(e.target)) {
        dropdown.remove();
        document.removeEventListener('click', closeDropdown);
      }
    });
  }, 0);
}

// ── 標記修改 ──────────────────────────────────

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

// ── 儲存 / 取消 / 離開 ────────────────────────

export async function saveEdits() {
  const currentScheduleName = getCurrentScheduleName();
  const editingData = getEditingData();
  const onSaveSuccess = () => {
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
  };

  if (currentScheduleName) {
    try {
      const result = await api.post('schedules', {
        name: currentScheduleName,
        data: editingData,
        profile: getAppState().activeProfile,
      });
      if (result) {
        onSaveSuccess();
        getActiveProfile().schedules[currentScheduleName] = getGeneratedData();
        showToast('班表修改已儲存並同步到雲端！', 'success');
      } else {
        showToast('同步到雲端時發生錯誤，請稍後再試。', 'error');
      }
    } catch {
      showToast('同步到雲端時發生錯誤，請稍後再試。', 'error');
    }
  } else {
    onSaveSuccess();
    showToast('班表修改已儲存！', 'success');
  }
}

export async function cancelEdits() {
  if (getHasUnsavedChanges()) {
    const ok = await showConfirm('確定要放棄所有未儲存的修改嗎？');
    if (!ok) return;
  }
  clearDraft();
  setEditingData(JSON.parse(JSON.stringify(getGeneratedData())));
  setHasUnsavedChanges(false);
  renderEditableSchedule();
}

export async function exitEditMode() {
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
    if (response?.html) document.getElementById('schedule-output').innerHTML = response.html;
  }).catch(() => {
    showToast('無法載入預覽模式，請重新整理頁面', 'error');
  });
}
