import {
  getGeneratedData, setGeneratedData,
  getEditingData, setEditingData,
  getHasUnsavedChanges, setHasUnsavedChanges,
  getCurrentScheduleName, getAppState, getActiveProfile,
} from '../../state/appState.js';
import {
  pushEditHistory, undoEdit, redoEdit, clearEditHistory,
  getHistoryLock, setHistoryLock,
} from '../../state/historyStack.js';
import { autoSaveDraft, clearDraft } from '../../state/draftManager.js';
import { api } from '../../api/client.js';
import { showToast } from '../../ui/toast.js';
import { showConfirm } from '../../ui/modal.js';
import { showDiffModal } from './diffSummary.js';
import { renderPersonnelView } from './personnelView.js';

let draggedPerson = null;
let draggedFromCell = null;

export function enableEditMode() {
  if (!getGeneratedData()) return;
  setEditingData(JSON.parse(JSON.stringify(getGeneratedData())));
  setHasUnsavedChanges(false);
  clearEditHistory();
  renderEditableSchedule();
}

export function renderEditableSchedule() {
  const editingData = getEditingData();
  if (!editingData) return;

  const container = document.getElementById('schedule-output');
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

export function initEditToolbarEvents() {
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
      document.getElementById('schedule-output').innerHTML = response.html;
    }
  }).catch((error) => {
    console.error('渲染班表失敗:', error);
    showToast('無法載入預覽模式，請重新整理頁面', 'error');
  });
}
