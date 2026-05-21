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
  banner.className = 'draft-banner';
  banner.innerHTML = `
    <span class="draft-msg">找到 ${label} 的未儲存草稿（設定檔：${escapeHtml(draft.profile)}）</span>
    <div class="draft-actions">
      <button id="draft-restore-btn" class="btn btn-primary btn-sm">恢復草稿</button>
      <button id="draft-discard-btn" class="btn btn-ghost btn-sm">捨棄</button>
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
