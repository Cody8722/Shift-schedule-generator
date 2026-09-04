import { describe, it, expect, beforeEach } from 'vitest';
import { buildExportFilename } from './exportFilename.js';
import { setCurrentScheduleName } from '../state/appState.js';

const makeWeek = (dateRange) => ({ dateRange });
const fixedNow = new Date(2026, 8, 4, 14, 30, 22); // 2026-09-04 14:30:22

describe('buildExportFilename', () => {
  beforeEach(() => {
    setCurrentScheduleName(null);
  });

  it('沒有已儲存班表名稱時用 fallbackBase 當開頭', () => {
    const name = buildExportFilename([makeWeek('09/07 - 09/11')], 'pdf', { now: fixedNow });
    expect(name).toBe('班表_0907~0911_20260904-143022.pdf');
  });

  it('有已儲存班表名稱時優先使用該名稱', () => {
    setCurrentScheduleName('中午');
    const name = buildExportFilename([makeWeek('09/07 - 09/11')], 'pdf', { now: fixedNow });
    expect(name).toBe('中午_0907~0911_20260904-143022.pdf');
  });

  it('多週時日期範圍取第一週開始到最後一週結束', () => {
    const data = [makeWeek('09/07 - 09/11'), makeWeek('09/14 - 09/18'), makeWeek('09/21 - 09/25')];
    const name = buildExportFilename(data, 'xlsx', { now: fixedNow });
    expect(name).toBe('班表_0907~0925_20260904-143022.xlsx');
  });

  it('suffix 會接在名稱後面（人員 Excel 用）', () => {
    const name = buildExportFilename([makeWeek('09/07 - 09/11')], 'xlsx', {
      suffix: '_人員',
      now: fixedNow,
    });
    expect(name).toBe('班表_人員_0907~0911_20260904-143022.xlsx');
  });

  it('沒有匯出資料時仍回傳合理檔名（只含名稱與時間戳）', () => {
    const name = buildExportFilename(null, 'pdf', { now: fixedNow });
    expect(name).toBe('班表_20260904-143022.pdf');
  });

  it('沒有匯出資料但有已儲存班表名稱時使用該名稱', () => {
    setCurrentScheduleName('中午');
    const name = buildExportFilename([], 'pdf', { now: fixedNow });
    expect(name).toBe('中午_20260904-143022.pdf');
  });
});
