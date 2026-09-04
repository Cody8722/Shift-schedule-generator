/**
 * 全域應用狀態。
 * 使用 getter/setter 確保外部只能透過明確 API 修改。
 */

let _appState = {
  activeProfile: 'default',
  profiles: {
    default: {
      settings: { tasks: [], personnel: [] },
      schedules: {},
    },
  },
};

let _generatedData = null;
let _editingData = null;
let _hasUnsavedChanges = false;
let _currentScheduleName = null;
let _selectedWeeks = new Set();

// ── appState ──
export const getAppState = () => _appState;
export const setAppState = (newState) => {
  _appState = { ..._appState, ...newState };
};

export const getActiveProfile = () => _appState.profiles[_appState.activeProfile];

// ── generatedData ──
export const getGeneratedData = () => _generatedData;
export const setGeneratedData = (data) => {
  _generatedData = data;
  // 每次拿到新班表（產生或載入）就重設匯出週次篩選為全選，避免殘留上一份班表的選擇
  _selectedWeeks = new Set(data ? data.map((_, i) => i) : []);
};

// ── selectedWeeks（匯出用的週次篩選）──
export const getSelectedWeeks = () => _selectedWeeks;
export const setSelectedWeeks = (weeks) => {
  _selectedWeeks = weeks;
};

// ── editingData ──
export const getEditingData = () => _editingData;
export const setEditingData = (data) => {
  _editingData = data;
};

// ── hasUnsavedChanges ──
export const getHasUnsavedChanges = () => _hasUnsavedChanges;
export const setHasUnsavedChanges = (value) => {
  _hasUnsavedChanges = value;
};

// ── currentScheduleName ──
export const getCurrentScheduleName = () => _currentScheduleName;
export const setCurrentScheduleName = (name) => {
  _currentScheduleName = name;
};
