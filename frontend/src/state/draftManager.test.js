import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setEditingData,
  setGeneratedData,
  setCurrentScheduleName,
  setAppState,
  getAppState,
} from './appState.js';
import { autoSaveDraft, clearDraft } from './draftManager.js';

// ── 環境設定 ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  setEditingData(null);
  setGeneratedData(null);
  setCurrentScheduleName(null);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

// ── autoSaveDraft ─────────────────────────────────────────────────────────────

describe('autoSaveDraft', () => {
  it('editingData 為 null 時計時器觸發後不寫入 localStorage', () => {
    setEditingData(null);
    autoSaveDraft();
    vi.runAllTimers();
    expect(localStorage.getItem('schedule_draft')).toBeNull();
  });

  it('editingData 存在時 2 秒後寫入 schedule_draft', () => {
    setEditingData([{ week: 1 }]);
    setGeneratedData([{ week: 0 }]);
    setCurrentScheduleName('排班-2025');
    autoSaveDraft();
    expect(localStorage.getItem('schedule_draft')).toBeNull(); // 尚未觸發
    vi.runAllTimers();
    const raw = localStorage.getItem('schedule_draft');
    expect(raw).not.toBeNull();
    const draft = JSON.parse(raw);
    expect(draft.editingData).toEqual([{ week: 1 }]);
    expect(draft.scheduleName).toBe('排班-2025');
    expect(draft.generatedData).toEqual([{ week: 0 }]);
    expect(draft).toHaveProperty('savedAt');
    expect(draft).toHaveProperty('profile');
  });

  it('儲存的 profile 來自 appState.activeProfile', () => {
    setAppState({ activeProfile: 'my-team' });
    setEditingData([{ w: 1 }]);
    autoSaveDraft();
    vi.runAllTimers();
    const draft = JSON.parse(localStorage.getItem('schedule_draft'));
    expect(draft.profile).toBe('my-team');
  });

  it('多次連續呼叫只執行一次儲存（debounce）', () => {
    setEditingData([{ week: 1 }]);
    autoSaveDraft();
    autoSaveDraft();
    autoSaveDraft();
    vi.runAllTimers();
    // 只有一筆 draft 被寫入
    expect(localStorage.getItem('schedule_draft')).not.toBeNull();
    const draft = JSON.parse(localStorage.getItem('schedule_draft'));
    expect(draft.editingData).toEqual([{ week: 1 }]);
  });

  it('儲存的 savedAt 是數字（Unix timestamp）', () => {
    setEditingData([{ w: 1 }]);
    autoSaveDraft();
    vi.runAllTimers();
    const draft = JSON.parse(localStorage.getItem('schedule_draft'));
    expect(typeof draft.savedAt).toBe('number');
  });
});

// ── clearDraft ────────────────────────────────────────────────────────────────

describe('clearDraft', () => {
  it('清除 localStorage 中的 schedule_draft', () => {
    localStorage.setItem('schedule_draft', JSON.stringify({ test: true }));
    clearDraft();
    expect(localStorage.getItem('schedule_draft')).toBeNull();
  });

  it('沒有 draft 時呼叫不報錯', () => {
    expect(() => clearDraft()).not.toThrow();
  });

  it('取消尚未觸發的 autoSaveDraft 計時器', () => {
    setEditingData([{ week: 1 }]);
    autoSaveDraft();    // 計時器已排程
    clearDraft();       // 應取消計時器並清除 draft
    vi.runAllTimers();  // 計時器不再觸發
    expect(localStorage.getItem('schedule_draft')).toBeNull();
  });
});
