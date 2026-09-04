import { describe, it, expect, beforeEach } from 'vitest';
import { getExportData } from './exportWeekFilter.js';
import { setGeneratedData, setEditingData, setSelectedWeeks, getSelectedWeeks } from '../../state/appState.js';

const makeWeek = (dateRange) => ({ dateRange, tasks: [], schedule: [], scheduleDays: [] });

describe('getExportData', () => {
  beforeEach(() => {
    setGeneratedData(null);
    setEditingData(null);
  });

  it('沒有資料時回傳 null', () => {
    expect(getExportData()).toBeNull();
  });

  it('產生班表後預設全選，回傳所有週並標記正確的 weekIndex', () => {
    setGeneratedData([makeWeek('W1'), makeWeek('W2'), makeWeek('W3')]);
    const result = getExportData();
    expect(result).toHaveLength(3);
    expect(result.map((w) => w.weekIndex)).toEqual([0, 1, 2]);
  });

  it('取消某週的勾選後，該週不會出現在匯出資料，其餘週的 weekIndex 維持原始序號', () => {
    setGeneratedData([makeWeek('W1'), makeWeek('W2'), makeWeek('W3')]);
    const selected = new Set(getSelectedWeeks());
    selected.delete(1); // 取消第 2 週
    setSelectedWeeks(selected);

    const result = getExportData();
    expect(result).toHaveLength(2);
    expect(result.map((w) => w.weekIndex)).toEqual([0, 2]);
    expect(result.map((w) => w.dateRange)).toEqual(['W1', 'W3']);
  });

  it('有編輯中資料時優先使用 editingData，週次篩選仍套用同一份 selectedWeeks', () => {
    setGeneratedData([makeWeek('原始W1'), makeWeek('原始W2')]);
    const selected = new Set(getSelectedWeeks());
    selected.delete(0);
    setSelectedWeeks(selected);

    setEditingData([makeWeek('編輯W1'), makeWeek('編輯W2')]);
    const result = getExportData();
    expect(result).toHaveLength(1);
    expect(result[0].dateRange).toBe('編輯W2');
    expect(result[0].weekIndex).toBe(1);
  });

  it('重新產生班表會把週次篩選重設為全選', () => {
    setGeneratedData([makeWeek('W1'), makeWeek('W2')]);
    const selected = new Set(getSelectedWeeks());
    selected.delete(0);
    setSelectedWeeks(selected);
    expect(getExportData()).toHaveLength(1);

    setGeneratedData([makeWeek('新W1'), makeWeek('新W2'), makeWeek('新W3')]);
    const result = getExportData();
    expect(result).toHaveLength(3);
  });
});
