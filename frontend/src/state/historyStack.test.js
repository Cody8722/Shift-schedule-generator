import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setEditingData, getEditingData } from './appState.js';
import {
  pushEditHistory,
  undoEdit,
  redoEdit,
  clearEditHistory,
  getHistoryLock,
  setHistoryLock,
} from './historyStack.js';

// ── 重置模組層級狀態 ────────────────────────────────────────────────────────

beforeEach(() => {
  clearEditHistory();
  setHistoryLock(false);
  setEditingData(null);
});

// ── pushEditHistory ──────────────────────────────────────────────────────────

describe('pushEditHistory', () => {
  it('editingData 為 null 時不推入堆疊', () => {
    setEditingData(null);
    pushEditHistory();
    const cb = vi.fn();
    undoEdit(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('historyLock 為 true 時不推入堆疊', () => {
    setEditingData([{ week: 1 }]);
    setHistoryLock(true);
    pushEditHistory();
    const cb = vi.fn();
    undoEdit(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('正常狀態下推入 editingData 的深複製快照', () => {
    setEditingData([{ week: 1 }]);
    pushEditHistory();
    setEditingData([{ week: 2 }]);
    const cb = vi.fn();
    undoEdit(cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getEditingData()).toEqual([{ week: 1 }]);
  });

  it('push 後清空 redoStack', () => {
    setEditingData([{ v: 'a' }]);
    pushEditHistory();
    setEditingData([{ v: 'b' }]);
    undoEdit(vi.fn()); // redoStack now has [{v:'b'}]
    setEditingData([{ v: 'c' }]);
    pushEditHistory(); // should clear redo
    const cb = vi.fn();
    redoEdit(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('超過 MAX_HISTORY(20) 時移除最舊快照，堆疊維持 20 筆', () => {
    for (let i = 0; i < 22; i++) {
      setEditingData([{ n: i }]);
      pushEditHistory();
    }
    setEditingData([{ n: 22 }]);
    let count = 0;
    const cb = vi.fn(() => count++);
    for (let i = 0; i < 25; i++) undoEdit(cb);
    expect(count).toBe(20);
  });
});

// ── undoEdit ─────────────────────────────────────────────────────────────────

describe('undoEdit', () => {
  it('堆疊為空時不呼叫 renderCallback', () => {
    const cb = vi.fn();
    undoEdit(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('執行後 editingData 回到上一個快照', () => {
    setEditingData([{ step: 1 }]);
    pushEditHistory();
    setEditingData([{ step: 2 }]);
    undoEdit(vi.fn());
    expect(getEditingData()).toEqual([{ step: 1 }]);
  });

  it('執行後呼叫 renderCallback 一次', () => {
    setEditingData([{ step: 1 }]);
    pushEditHistory();
    setEditingData([{ step: 2 }]);
    const cb = vi.fn();
    undoEdit(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('執行後將目前狀態推入 redoStack，redo 可恢復', () => {
    setEditingData([{ step: 1 }]);
    pushEditHistory();
    setEditingData([{ step: 2 }]);
    undoEdit(vi.fn()); // editing → step1, redo has step2
    redoEdit(vi.fn()); // editing → step2 again
    expect(getEditingData()).toEqual([{ step: 2 }]);
  });

  it('連續多次 undo 依序恢復歷史', () => {
    setEditingData([{ n: 1 }]); pushEditHistory();
    setEditingData([{ n: 2 }]); pushEditHistory();
    setEditingData([{ n: 3 }]);
    undoEdit(vi.fn());
    expect(getEditingData()).toEqual([{ n: 2 }]);
    undoEdit(vi.fn());
    expect(getEditingData()).toEqual([{ n: 1 }]);
  });
});

// ── redoEdit ──────────────────────────────────────────────────────────────────

describe('redoEdit', () => {
  it('redoStack 為空時不呼叫 renderCallback', () => {
    const cb = vi.fn();
    redoEdit(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('執行後 editingData 恢復至 redo 快照', () => {
    setEditingData([{ v: 'a' }]); pushEditHistory();
    setEditingData([{ v: 'b' }]);
    undoEdit(vi.fn());
    redoEdit(vi.fn());
    expect(getEditingData()).toEqual([{ v: 'b' }]);
  });

  it('執行後呼叫 renderCallback 一次', () => {
    setEditingData([{ v: 'a' }]); pushEditHistory();
    setEditingData([{ v: 'b' }]);
    undoEdit(vi.fn());
    const cb = vi.fn();
    redoEdit(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('redo 後再 undo 可再次回到前一狀態', () => {
    setEditingData([{ v: 'a' }]); pushEditHistory();
    setEditingData([{ v: 'b' }]);
    undoEdit(vi.fn()); // → a
    redoEdit(vi.fn()); // → b
    undoEdit(vi.fn()); // → a again
    expect(getEditingData()).toEqual([{ v: 'a' }]);
  });
});

// ── clearEditHistory ──────────────────────────────────────────────────────────

describe('clearEditHistory', () => {
  it('清空後 undoEdit 不觸發 callback', () => {
    setEditingData([{ x: 1 }]); pushEditHistory();
    clearEditHistory();
    const cb = vi.fn();
    undoEdit(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('清空後 redoEdit 不觸發 callback', () => {
    setEditingData([{ x: 1 }]); pushEditHistory();
    setEditingData([{ x: 2 }]);
    undoEdit(vi.fn()); // populate redo
    clearEditHistory();
    const cb = vi.fn();
    redoEdit(cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ── setHistoryLock / getHistoryLock ───────────────────────────────────────────

describe('getHistoryLock / setHistoryLock', () => {
  it('預設為 false', () => {
    expect(getHistoryLock()).toBe(false);
  });

  it('setHistoryLock(true) 後 getHistoryLock() 回傳 true', () => {
    setHistoryLock(true);
    expect(getHistoryLock()).toBe(true);
  });

  it('setHistoryLock(false) 後可正常 push', () => {
    setHistoryLock(true);
    setHistoryLock(false);
    setEditingData([{ v: 1 }]);
    pushEditHistory();
    setEditingData([{ v: 2 }]);
    const cb = vi.fn();
    undoEdit(cb);
    expect(cb).toHaveBeenCalled();
  });
});
