import { escapeHtml } from '../utils/escapeHtml.js';
import { showToast } from '../ui/toast.js';
import {
  getAppState,
  getGeneratedData,
  getEditingData,
  getCurrentScheduleName,
  setGeneratedData,
  setEditingData,
  setCurrentScheduleName,
  setHasUnsavedChanges,
} from './appState.js';
import { clearEditHistory } from './historyStack.js';

const _draftTimer = { id: null };

export const autoSaveDraft = () => {
  clearTimeout(_draftTimer.id);
  _draftTimer.id = setTimeout(() => {
    const editingData = getEditingData();
    if (!editingData) return;
    try {
      const appState = getAppState();
      localStorage.setItem(
        'schedule_draft',
        JSON.stringify({
          profile: appState.activeProfile,
          scheduleName: getCurrentScheduleName(),
          generatedData: getGeneratedData(),
          editingData,
          savedAt: Date.now(),
        })
      );
    } catch {
      // quota exceeded, skip
    }
  }, 2000);
};

export const clearDraft = () => {
  clearTimeout(_draftTimer.id);
  localStorage.removeItem('schedule_draft');
};

/**
 * 顯示草稿恢復橫幅。
 * @param {object} draft
 * @param {number} mins
 * @param {Function} renderEditableScheduleCallback
 */
export const showDraftBanner = (draft, mins, renderEditableScheduleCallback) => {
  const existing = document.getElementById('draft-banner');
  if (existing) existing.remove();

  const label = mins < 1 ? '剛才' : `${mins} 分鐘前`;
  const banner = document.createElement('div');
  banner.id = 'draft-banner';
  banner.className =
    'mb-4 p-3 bg-amber-50 dark:bg-amber-900 border border-amber-300 dark:border-amber-600 rounded-lg flex items-center justify-between text-sm';
  banner.innerHTML = `
    <span class="text-amber-800 dark:text-amber-200">找到 ${label} 的未儲存草稿（設定檔：${escapeHtml(draft.profile)}）</span>
    <div class="flex gap-2 ml-3 shrink-0">
      <button id="draft-restore-btn" class="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded text-xs">恢復草稿</button>
      <button id="draft-discard-btn" class="bg-gray-400 hover:bg-gray-500 text-white px-3 py-1 rounded text-xs">捨棄</button>
    </div>`;

  const container = document.getElementById('output-container');
  container.prepend(banner);
  container.classList.remove('hidden');

  document.getElementById('draft-restore-btn').addEventListener('click', () => {
    setGeneratedData(draft.generatedData);
    setEditingData(draft.editingData);
    setCurrentScheduleName(draft.scheduleName);
    setHasUnsavedChanges(true);
    clearEditHistory();
    renderEditableScheduleCallback();
    banner.remove();
    clearDraft();
    showToast('草稿已恢復', 'success');
  });

  document.getElementById('draft-discard-btn').addEventListener('click', () => {
    banner.remove();
    clearDraft();
  });
};
