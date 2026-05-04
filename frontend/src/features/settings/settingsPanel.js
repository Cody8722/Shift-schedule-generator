import { escapeHtml } from '../../utils/escapeHtml.js';
import { api } from '../../api/client.js';
import {
  getAppState,
  getActiveProfile,
  getGeneratedData,
} from '../../state/appState.js';
import { pushSettingsHistory } from '../../state/historyStack.js';
import { generateFullSchedule } from '../schedule/scheduleGenerator.js';

export const updateCapacityStatus = () => {
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

export const renderTasks = () => {
  const taskList = document.getElementById('task-list');
  if (!taskList) return;
  taskList.innerHTML = '';
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
    taskList.appendChild(div);
  });
  updateCapacityStatus();
};

export const renderPersonnel = () => {
  const personnelList = document.getElementById('personnel-list');
  if (!personnelList) return;
  personnelList.innerHTML = '';
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
    personnelList.appendChild(div);
  });
  updateCapacityStatus();
};

export const renderProfileSelector = () => {
  const profileSelect = document.getElementById('profile-select');
  const badge = document.getElementById('active-profile-badge');
  if (!profileSelect) return;
  const appState = getAppState();
  profileSelect.innerHTML = '';
  Object.keys(appState.profiles).forEach((name) => {
    const option = document.createElement('option');
    option.value = option.textContent = name;
    if (name === appState.activeProfile) option.selected = true;
    profileSelect.appendChild(option);
  });
  if (badge) badge.textContent = appState.activeProfile;
};

export const renderSavedSchedules = () => {
  const savedSchedulesList = document.getElementById('saved-schedules-list');
  if (!savedSchedulesList) return;
  const schedules = getActiveProfile()?.schedules;
  const scheduleNames = schedules ? Object.keys(schedules) : [];
  if (scheduleNames.length === 0) {
    savedSchedulesList.innerHTML =
      '<li class="text-gray-400 dark:text-gray-500 text-center py-3 text-sm">尚無儲存的班表<br><span class="text-xs">產生班表後點擊「儲存班表」</span></li>';
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

export const saveSettings = async () => {
  const activeProfile = getActiveProfile();
  if (!activeProfile) return;
  await api.put(`profiles/${getAppState().activeProfile}`, { settings: activeProfile.settings });
};

export const handleSettingsChange = async (updateFn) => {
  pushSettingsHistory();
  updateFn();
  renderAll();
  await saveSettings();
  if (getGeneratedData()) {
    const outputContainer = document.getElementById('output-container');
    if (outputContainer) outputContainer.style.opacity = '0.5';
    await generateFullSchedule();
    if (outputContainer) outputContainer.style.opacity = '1';
  }
};
