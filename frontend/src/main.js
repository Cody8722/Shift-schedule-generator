/**
 * v2 前端入口點
 *
 * 初始化所有模組，並接線 DOM 事件。
 * 本檔案扮演原 index.html 內嵌 <script> 的角色，
 * 各功能已拆分至對應模組，這裡負責組合與驅動。
 */

// ── 工具 ──
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
  setCurrentScheduleName,
} from './state/appState.js';
import {
  pushSettingsHistory,
  undoEdit,
  redoEdit,
  undoSettings,
  redoSettings,
  clearEditHistory,
  clearSettingsHistory,
} from './state/historyStack.js';
import {
  clearDraft,
  showDraftBanner,
} from './state/draftManager.js';

// ── UI ──
import { showToast } from './ui/toast.js';
import { showInput, showConfirm } from './ui/modal.js';
import { applyTheme, currentTheme } from './ui/theme.js';
import { initTutorial } from './ui/tutorial.js';

// ── Features ──
import { renderPersonnelView, exportPersonnelExcel } from './features/schedule/personnelView.js';
import { printSchedule, exportToPdf } from './features/schedule/pdfExport.js';
import { renderAll, renderSavedSchedules } from './features/settings/settingsRenderer.js';
import { enableEditMode, renderEditableSchedule, initEditToolbarEvents } from './features/schedule/editableSchedule.js';
import { generateFullSchedule, displaySchedule } from './features/schedule/scheduleGenerator.js';
import { initScheduleCompare } from './features/schedule/scheduleCompare.js';

// ── Utils ──
import { checkConnectionStatus } from './utils/connectionStatus.js';
import { downloadWorkbook } from './utils/excelDownload.js';

// ─────────────────────────────────────────────
// DOM 元素集合（在 DOMContentLoaded 後填入）
// ─────────────────────────────────────────────
let elements = {};

// ── 本地可編輯班表狀態 ──
let availableHolidays = [];
let activeHolidayDates = new Set();
let currentEditingPersonnelIndex = -1;
let statusCheckInterval = null;
let appInitialized = false;


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
    if (getHasUnsavedChanges()) {
      const ok = await showConfirm(
        '班表有手動調整尚未儲存，變更設定會重新產生班表並覆蓋這些修改，確定要繼續嗎？'
      );
      if (!ok) {
        showToast('設定已儲存，但班表未重新產生（手動修改已保留）', 'info', 4000);
        return;
      }
    }
    elements.outputContainer.style.opacity = '0.5';
    await generateFullSchedule(Array.from(activeHolidayDates));
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
  if (!appInitialized) {
    elements.startWeekInput.value = `${year}-W${String(weekNo).padStart(2, '0')}`;
    debouncedUpdateHolidays();
    setInitialAccordionState();
    if (statusCheckInterval) clearInterval(statusCheckInterval);
    statusCheckInterval = setInterval(checkConnectionStatus, 30000);
    document.getElementById('footer-year').textContent = new Date().getFullYear();
    appInitialized = true;
  }

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

  // 全域 modal × 關閉鈕（class="modal-close"，無 ID）
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.modal-close');
    if (!closeBtn) return;
    const backdrop = closeBtn.closest('.modal-backdrop');
    if (!backdrop) return;
    // confirm/input modal 的 × 要走取消流程，讓 Promise 正確 resolve
    const cancelBtn = backdrop.querySelector('#confirm-modal-cancel, #input-modal-cancel');
    if (cancelBtn) {
      cancelBtn.click();
    } else {
      backdrop.classList.remove('open');
    }
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
  elements.generateBtn.addEventListener('click', () => generateFullSchedule(Array.from(activeHolidayDates)));

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
  elements.exportExcelBtn.addEventListener('click', async () => {
    const generatedData = getGeneratedData();
    if (!generatedData) return;
    const wb = new window.ExcelJS.Workbook();
    generatedData.forEach((data, index) => {
      const { schedule, tasks, weekDayDates, scheduleDays } = data;
      const ws = wb.addWorksheet(`第${index + 1}週`);
      ws.columns = Array(6).fill({ width: 15 });

      const headerRow = ws.addRow([
        '勤務地點',
        ...weekDayDates.map(
          (date, i) => `星期${['一', '二', '三', '四', '五'][i]}\n(${date})`
        ),
      ]);
      headerRow.eachCell((cell) => { cell.alignment = { wrapText: true, vertical: 'top' }; });

      tasks.forEach((task, taskIndex) => {
        const cells = [task.name];
        weekDayDates.forEach((_, dayIndex) => {
          cells.push(
            scheduleDays[dayIndex].shouldSchedule
              ? schedule[dayIndex][taskIndex].join('\n')
              : scheduleDays[dayIndex].description
          );
        });
        const row = ws.addRow(cells);
        row.eachCell((cell) => { cell.alignment = { wrapText: true, vertical: 'top' }; });
      });
    });
    await downloadWorkbook(wb, '班表.xlsx');
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
      generateFullSchedule(Array.from(activeHolidayDates)).then(() => {
        elements.outputContainer.style.opacity = '1';
      });
    }
  });

  elements.startWeekInput.addEventListener('change', debouncedUpdateHolidays);
  elements.numWeeksInput.addEventListener('input', debouncedUpdateHolidays);

  document.getElementById('diff-modal-close')?.addEventListener('click', () => {
    document.getElementById('diff-modal').classList.remove('open');
  });

  document.getElementById('diff-modal-close-2')?.addEventListener('click', () => {
    document.getElementById('diff-modal').classList.remove('open');
  });

  document.getElementById('diff-modal-apply')?.addEventListener('click', () => {
    document.getElementById('diff-modal').classList.remove('open');
  });

  document.getElementById('dm-revert')?.addEventListener('click', async () => {
    document.getElementById('diff-modal').classList.remove('open');
    const ok = await showConfirm('確定要捨棄所有變更，回到原始班表嗎？');
    if (!ok) return;
    clearDraft();
    setEditingData(JSON.parse(JSON.stringify(getGeneratedData())));
    setHasUnsavedChanges(false);
    clearEditHistory();
    const editStatus = document.getElementById('edit-status');
    if (editStatus) { editStatus.textContent = ''; editStatus.className = ''; }
    const saveEditsBtn = document.getElementById('save-edits-btn');
    if (saveEditsBtn) saveEditsBtn.disabled = true;
    renderEditableSchedule();
  });

  initEditToolbarEvents();
  initScheduleCompare();

  document.getElementById('enter-edit-btn')?.addEventListener('click', enableEditMode);

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

  document.getElementById('undo')?.addEventListener('click', () => undoSettings(renderAll, saveSettings));
  document.getElementById('redo')?.addEventListener('click', () => redoSettings(renderAll, saveSettings));

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
  initTutorial();
});


// 修正 debouncedUpdateHolidays 在 initApp 的參照
// 因為 debouncedUpdateHolidays 定義在 DOMContentLoaded 內，
// 此處提供一個橋接讓 initApp 內可以呼叫
const debouncedUpdateHolidays = (...args) => {
  if (window._debouncedUpdateHolidays) {
    window._debouncedUpdateHolidays(...args);
  }
};
