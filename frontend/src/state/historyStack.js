import { showToast } from '../ui/toast.js';
import {
  getEditingData,
  setEditingData,
  getAppState,
  getActiveProfile,
} from './appState.js';

const MAX_HISTORY = 20;

let editUndoStack = [];
let editRedoStack = [];
let settingsUndoStack = [];
let settingsRedoStack = [];
let _historyLock = false;

// ── 內部工具 ──
const _updateUndoRedoBtns = () => {
  const u = document.getElementById('undo-edit-btn');
  const r = document.getElementById('redo-edit-btn');
  if (u) u.disabled = editUndoStack.length === 0;
  if (r) r.disabled = editRedoStack.length === 0;
};

// ── 編輯歷史 ──
export const getHistoryLock = () => _historyLock;
export const setHistoryLock = (val) => {
  _historyLock = val;
};

export const pushEditHistory = () => {
  if (_historyLock || !getEditingData()) return;
  editUndoStack.push(JSON.stringify(getEditingData()));
  if (editUndoStack.length > MAX_HISTORY) editUndoStack.shift();
  editRedoStack = [];
  _updateUndoRedoBtns();
};

export const undoEdit = (renderCallback) => {
  if (!editUndoStack.length) return;
  editRedoStack.push(JSON.stringify(getEditingData()));
  setEditingData(JSON.parse(editUndoStack.pop()));
  renderCallback();
  _updateUndoRedoBtns();
  showToast('已復原', 'info', 1500);
};

export const redoEdit = (renderCallback) => {
  if (!editRedoStack.length) return;
  editUndoStack.push(JSON.stringify(getEditingData()));
  setEditingData(JSON.parse(editRedoStack.pop()));
  renderCallback();
  _updateUndoRedoBtns();
  showToast('已重做', 'info', 1500);
};

export const clearEditHistory = () => {
  editUndoStack = [];
  editRedoStack = [];
  _updateUndoRedoBtns();
};

// ── 設定歷史 ──
export const pushSettingsHistory = () => {
  const profile = getActiveProfile();
  if (!profile) return;
  settingsUndoStack.push(JSON.stringify(profile.settings));
  if (settingsUndoStack.length > MAX_HISTORY) settingsUndoStack.shift();
  settingsRedoStack = [];
};

export const undoSettings = async (renderAllCallback, saveSettingsCallback) => {
  if (!settingsUndoStack.length) return;
  const profile = getActiveProfile();
  settingsRedoStack.push(JSON.stringify(profile.settings));
  profile.settings = JSON.parse(settingsUndoStack.pop());
  renderAllCallback();
  await saveSettingsCallback();
  showToast('已復原設定', 'info', 1500);
};

export const redoSettings = async (renderAllCallback, saveSettingsCallback) => {
  if (!settingsRedoStack.length) return;
  const profile = getActiveProfile();
  settingsUndoStack.push(JSON.stringify(profile.settings));
  profile.settings = JSON.parse(settingsRedoStack.pop());
  renderAllCallback();
  await saveSettingsCallback();
  showToast('已重做設定', 'info', 1500);
};

export const clearSettingsHistory = () => {
  settingsUndoStack = [];
  settingsRedoStack = [];
};
