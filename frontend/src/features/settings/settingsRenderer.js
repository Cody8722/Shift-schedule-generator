import { getActiveProfile, getAppState } from '../../state/appState.js';
import { escapeHtml } from '../../utils/escapeHtml.js';
import { updateCapacityStatus } from '../../utils/capacityStatus.js';

const renderTasks = () => {
  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '';
  const tasks = getActiveProfile()?.settings?.tasks || [];
  if (tasks.length === 0) {
    const placeholder = document.createElement('p');
    placeholder.className = 'text-sm text-muted task-list-placeholder';
    placeholder.textContent = '（尚未新增勤務）';
    taskList.appendChild(placeholder);
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
      taskList.appendChild(div);
    });
  }
  updateCapacityStatus();
};

const renderPersonnel = () => {
  const personnelList = document.getElementById('personnel-list');
  personnelList.innerHTML = '';
  const personnel = getActiveProfile()?.settings?.personnel || [];
  if (personnel.length === 0) {
    const placeholder = document.createElement('p');
    placeholder.className = 'text-sm text-muted personnel-list-placeholder';
    placeholder.textContent = '（尚未新增人員）';
    personnelList.appendChild(placeholder);
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
      personnelList.appendChild(div);
    });
  }
  updateCapacityStatus();
};

const renderProfileSelector = () => {
  const profileSelect = document.getElementById('profile-select');
  const appState = getAppState();
  profileSelect.innerHTML = '';
  Object.keys(appState.profiles).forEach((name) => {
    const option = document.createElement('option');
    option.value = option.textContent = name;
    if (name === appState.activeProfile) option.selected = true;
    profileSelect.appendChild(option);
  });
  const badge = document.getElementById('active-profile-badge');
  if (badge) badge.textContent = appState.activeProfile;
};

export const renderSavedSchedules = () => {
  const savedSchedulesList = document.getElementById('saved-schedules-list');
  const schedules = getActiveProfile()?.schedules;
  const scheduleNames = schedules ? Object.keys(schedules) : [];
  if (scheduleNames.length === 0) {
    savedSchedulesList.innerHTML =
      '<li class="saved-empty">尚無儲存的班表<span class="hint">產生班表後點擊「儲存班表」</span></li>';
    return;
  }
  savedSchedulesList.innerHTML = '';
  scheduleNames.forEach((name) => {
    const li = document.createElement('li');
    li.className = 'flex justify-between items-center';
    li.innerHTML = `
      <a href="#" class="load-schedule-link hover:underline" data-name="${escapeHtml(name)}">${escapeHtml(name)}</a>
      <button class="delete-schedule-btn text-red-500 hover:text-red-700 text-xs p-1" data-name="${escapeHtml(name)}">刪除</button>
    `;
    savedSchedulesList.appendChild(li);
  });
};

export const renderAll = () => {
  renderProfileSelector();
  renderTasks();
  renderPersonnel();
  renderSavedSchedules();
};
