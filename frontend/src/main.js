// ── 狀態 ──
import {
  getAppState, setAppState, getActiveProfile,
  getGeneratedData, setGeneratedData,
  getEditingData, setEditingData,
  getHasUnsavedChanges, setHasUnsavedChanges,
  getCurrentScheduleName, setCurrentScheduleName,
} from './state/appState.js';
import {
  undoEdit, redoEdit, clearEditHistory,
  undoSettings, redoSettings, clearSettingsHistory,
} from './state/historyStack.js';
import { clearDraft, showDraftBanner } from './state/draftManager.js';

// ── API / UI ──
import { api } from './api/client.js';
import { showToast } from './ui/toast.js';
import { showInput, showConfirm } from './ui/modal.js';
import { applyTheme, currentTheme } from './ui/theme.js';

// ── 功能模組 ──
import {
  renderAll, renderSavedSchedules, saveSettings, handleSettingsChange,
} from './features/settings/settingsPanel.js';
import {
  getAvailableHolidays, getActiveHolidayDates, setActiveHolidayDates,
  updateHolidayButtonText, debouncedUpdateHolidays,
} from './features/holidays/holidaySelector.js';
import { generateFullSchedule, displaySchedule } from './features/schedule/scheduleGenerator.js';
import { renderEditableSchedule } from './features/schedule/editor.js';
import { renderPersonnelView, exportPersonnelExcel } from './features/schedule/personnelView.js';
import { copySchedule, exportToExcel, exportToPdf, printSchedule } from './features/schedule/scheduleExport.js';

// ─────────────────────────────────────────────
// 人員進階設定 Modal
// ─────────────────────────────────────────────
let currentEditingPersonnelIndex = -1;

const openPersonnelModal = (index) => {
  currentEditingPersonnelIndex = index;
  const person = getActiveProfile().settings.personnel[index];
  document.getElementById('modal-personnel-name').textContent = person.name;
  const weekDays = ['星期一', '星期二', '星期三', '星期四', '星期五'];
  document.getElementById('off-days-container').innerHTML = weekDays
    .map((day, dayIndex) => `
      <label class="flex items-center space-x-2">
        <input type="checkbox" class="form-checkbox rounded" value="${dayIndex}" ${person.offDays?.includes(dayIndex) ? 'checked' : ''}>
        <span>${day}</span>
      </label>`)
    .join('');
  const tasks = getActiveProfile().settings.tasks;
  document.getElementById('preferred-task-select').innerHTML =
    '<option value="">無偏好</option>' +
    tasks.map((task) =>
      `<option value="${task.name}" ${person.preferredTask === task.name ? 'selected' : ''}>${task.name}</option>`
    ).join('');
  document.getElementById('personnel-modal').classList.remove('hidden');
};

const closePersonnelModal = () => {
  document.getElementById('personnel-modal').classList.add('hidden');
  currentEditingPersonnelIndex = -1;
};

// ─────────────────────────────────────────────
// 連線狀態
// ─────────────────────────────────────────────
const checkConnectionStatus = async () => {
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  try {
    const response = await fetch('api/status');
    const data = await response.json();
    if (response.ok && data.database === 'connected') {
      if (statusIndicator) statusIndicator.className = 'w-3 h-3 rounded-full bg-green-500 transition-colors';
      if (statusText) statusText.textContent = '連線狀態：良好';
    } else {
      if (statusIndicator) statusIndicator.className = 'w-3 h-3 rounded-full bg-yellow-400 transition-colors';
      if (statusText) statusText.textContent = '連線狀態：資料庫異常';
    }
  } catch {
    if (statusIndicator) statusIndicator.className = 'w-3 h-3 rounded-full bg-red-500 transition-colors';
    if (statusText) statusText.textContent = '連線狀態：伺服器無回應';
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

  const today = new Date();
  const year = today.getFullYear();
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  document.getElementById('start-week').value = `${year}-W${String(weekNo).padStart(2, '0')}`;

  debouncedUpdateHolidays();
  setInitialAccordionState();
  setInterval(checkConnectionStatus, 30000);
  document.getElementById('footer-year').textContent = new Date().getFullYear();

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
// DOMContentLoaded — 事件綁定
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Accordion
  document.getElementById('accordion-container').addEventListener('click', (e) => {
    const header = e.target.closest('.accordion-header');
    if (header) header.parentElement.classList.toggle('active');
  });

  // 主題
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
  });

  // ── 勤務 ──
  document.getElementById('add-task-btn').addEventListener('click', () => {
    const name = document.getElementById('new-task-name').value.trim();
    const count = parseInt(document.getElementById('new-task-count').value, 10) || 1;
    const priority = parseInt(document.getElementById('new-task-priority').value, 10) || 9;
    if (name) {
      handleSettingsChange(() =>
        getActiveProfile().settings.tasks.push({ name, count, priority })
      );
      document.getElementById('new-task-name').value = '';
      document.getElementById('new-task-count').value = '1';
      document.getElementById('new-task-priority').value = '9';
    }
  });

  document.getElementById('task-list').addEventListener('change', (e) => {
    if (e.target.matches('input')) {
      const { index, field } = e.target.dataset;
      let value = e.target.type === 'number' ? parseInt(e.target.value, 10) : e.target.value.trim();
      if (e.target.type === 'number' && (isNaN(value) || value < 1)) value = 1;
      if (field === 'priority' && value > 9) value = 9;
      handleSettingsChange(() => (getActiveProfile().settings.tasks[index][field] = value));
    }
  });

  document.getElementById('task-list').addEventListener('click', (e) => {
    if (e.target.matches('.remove-task')) {
      handleSettingsChange(() =>
        getActiveProfile().settings.tasks.splice(e.target.dataset.index, 1)
      );
    }
  });

  // ── 人員 ──
  document.getElementById('add-personnel-btn').addEventListener('click', () => {
    const name = document.getElementById('new-personnel-name').value.trim();
    if (name) {
      handleSettingsChange(() =>
        getActiveProfile().settings.personnel.push({ name, maxShifts: 5, offDays: [], preferredTask: '' })
      );
      document.getElementById('new-personnel-name').value = '';
    }
  });

  document.getElementById('personnel-list').addEventListener('change', (e) => {
    if (e.target.matches('input')) {
      const { index, field } = e.target.dataset;
      let value = e.target.type === 'number' ? parseInt(e.target.value, 10) : e.target.value.trim();
      if (e.target.type === 'number' && (isNaN(value) || value < 1)) value = 1;
      handleSettingsChange(() => (getActiveProfile().settings.personnel[index][field] = value));
    }
  });

  document.getElementById('personnel-list').addEventListener('click', (e) => {
    if (e.target.matches('.remove-personnel')) {
      handleSettingsChange(() =>
        getActiveProfile().settings.personnel.splice(e.target.dataset.index, 1)
      );
    } else if (e.target.matches('.advanced-settings-btn')) {
      openPersonnelModal(parseInt(e.target.dataset.index, 10));
    }
  });

  document.getElementById('modal-close-btn').addEventListener('click', closePersonnelModal);
  document.getElementById('modal-save-btn').addEventListener('click', () => {
    if (currentEditingPersonnelIndex > -1) {
      handleSettingsChange(() => {
        const person = getActiveProfile().settings.personnel[currentEditingPersonnelIndex];
        person.offDays = Array.from(
          document.getElementById('off-days-container').querySelectorAll('input:checked')
        ).map((cb) => parseInt(cb.value, 10));
        person.preferredTask = document.getElementById('preferred-task-select').value;
      });
      closePersonnelModal();
    }
  });

  // ── 設定檔 ──
  document.getElementById('profile-select').addEventListener('change', async (e) => {
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
    document.getElementById('output-container').classList.add('hidden');
  });

  document.getElementById('new-profile-btn').addEventListener('click', async () => {
    const name = await showInput('新增設定檔', '');
    if (name) {
      if (getAppState().profiles[name]) { showToast('該名稱已存在！', 'warning'); return; }
      const result = await api.post('profiles', { name });
      if (result) await initApp();
    }
  });

  document.getElementById('rename-profile-btn').addEventListener('click', async () => {
    const oldName = getAppState().activeProfile;
    const newName = await showInput(`重新命名「${oldName}」`, oldName);
    if (newName && newName !== oldName) {
      if (getAppState().profiles[newName]) { showToast('該名稱已存在！', 'warning'); return; }
      const result = await api.put(`profiles/${oldName}/rename`, { newName });
      if (result) await initApp();
    }
  });

  document.getElementById('delete-profile-btn').addEventListener('click', async () => {
    const nameToDelete = getAppState().activeProfile;
    if (Object.keys(getAppState().profiles).length <= 1) {
      showToast('至少需保留一個設定檔！', 'warning'); return;
    }
    const ok = await showConfirm(`確定要刪除設定檔「${nameToDelete}」嗎？此操作無法復原。`);
    if (ok) {
      const result = await api.delete(`profiles/${nameToDelete}`);
      if (result) await initApp();
    }
  });

  document.getElementById('export-profile-btn').addEventListener('click', () => {
    const settings = getActiveProfile()?.settings;
    if (!settings) return;
    const blob = new Blob(
      [JSON.stringify({ settings, schedules: getActiveProfile()?.schedules || {} }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getAppState().activeProfile}_profile.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  });

  document.getElementById('import-profile-btn').addEventListener('click', () =>
    document.getElementById('profile-file-input').click()
  );
  document.getElementById('profile-file-input').addEventListener('change', (e) => {
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
          document.getElementById('output-container').classList.add('hidden');
          await saveSettings();
          renderAll();
        }
      } catch (err) {
        showToast(`檔案格式錯誤: ${err.message}`, 'error', 4000);
      }
    };
    reader.readAsText(file);
  });

  // ── 班表產生 / 匯出 ──
  document.getElementById('generate-schedule').addEventListener('click', generateFullSchedule);
  document.getElementById('copy-schedule').addEventListener('click', copySchedule);
  document.getElementById('export-excel').addEventListener('click', exportToExcel);
  document.getElementById('export-pdf').addEventListener('click', exportToPdf);
  document.getElementById('export-image-pdf').addEventListener('click', printSchedule);

  // ── 儲存班表 ──
  document.getElementById('save-schedule-btn').addEventListener('click', async () => {
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

  // ── 載入 / 刪除已儲存班表 ──
  document.getElementById('saved-schedules-list').addEventListener('click', async (e) => {
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

  // ── 假日設定 ──
  document.getElementById('holiday-settings-btn').addEventListener('click', () => {
    const availableHolidays = getAvailableHolidays();
    if (availableHolidays.length === 0) return;
    const activeHolidayDates = getActiveHolidayDates();
    document.getElementById('modal-holiday-list').innerHTML = availableHolidays
      .map((holiday) => `
        <label class="flex items-center space-x-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
          <input type="checkbox" class="form-checkbox rounded holiday-checkbox" value="${holiday.date}" ${activeHolidayDates.has(holiday.date) ? 'checked' : ''}>
          <span class="flex-grow">${holiday.name}</span>
          <span class="text-sm text-gray-500">(${holiday.date.substring(4, 6)}/${holiday.date.substring(6, 8)})</span>
        </label>`)
      .join('');
    document.getElementById('holiday-modal').classList.remove('hidden');
  });

  document.getElementById('modal-holiday-close-btn').addEventListener('click', () => {
    document.getElementById('holiday-modal').classList.add('hidden');
  });

  document.getElementById('modal-holiday-save-btn').addEventListener('click', () => {
    const checkedBoxes = document.getElementById('modal-holiday-list')
      .querySelectorAll('.holiday-checkbox:checked');
    setActiveHolidayDates(new Set(Array.from(checkedBoxes).map((cb) => cb.value)));
    updateHolidayButtonText();
    document.getElementById('holiday-modal').classList.add('hidden');
    if (getGeneratedData()) {
      const outputContainer = document.getElementById('output-container');
      outputContainer.style.opacity = '0.5';
      generateFullSchedule().then(() => { outputContainer.style.opacity = '1'; });
    }
  });

  document.getElementById('start-week').addEventListener('change', debouncedUpdateHolidays);
  document.getElementById('num-weeks').addEventListener('input', debouncedUpdateHolidays);

  document.getElementById('diff-modal-close')?.addEventListener('click', () => {
    document.getElementById('diff-modal').classList.add('hidden');
  });

  // ── 人員 / 班表 tab 切換 ──
  const personnelExcelBtn = document.getElementById('export-personnel-excel');
  const scheduleExcelBtn = document.getElementById('export-excel');

  document.getElementById('view-schedule-btn')?.addEventListener('click', () => {
    document.getElementById('schedule-output').classList.remove('hidden');
    document.getElementById('personnel-view').classList.add('hidden');
    document.getElementById('view-schedule-btn').className = 'px-3 py-1 rounded bg-blue-600 text-white text-xs';
    document.getElementById('view-personnel-btn').className =
      'px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs';
    scheduleExcelBtn?.classList.remove('hidden');
    personnelExcelBtn?.classList.add('hidden');
  });

  document.getElementById('view-personnel-btn')?.addEventListener('click', () => {
    renderPersonnelView(getEditingData() || getGeneratedData());
    document.getElementById('personnel-view').classList.remove('hidden');
    document.getElementById('schedule-output').classList.add('hidden');
    document.getElementById('view-personnel-btn').className = 'px-3 py-1 rounded bg-blue-600 text-white text-xs';
    document.getElementById('view-schedule-btn').className =
      'px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs';
    scheduleExcelBtn?.classList.add('hidden');
    personnelExcelBtn?.classList.remove('hidden');
  });

  personnelExcelBtn?.addEventListener('click', exportPersonnelExcel);

  // ── 全域鍵盤快捷鍵 ──
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
