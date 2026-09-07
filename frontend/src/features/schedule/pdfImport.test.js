import { describe, it, expect } from 'vitest';
import { splitPayload } from './pdfImport.js';

describe('splitPayload', () => {
  it('舊格式（純班表陣列）沒有 settings 可還原', () => {
    const legacy = [{ week: 1 }];
    expect(splitPayload(legacy)).toEqual({ schedule: legacy, settings: null });
  });

  it('新格式（{ schedule, settings }）正確拆出兩部分', () => {
    const schedule = [{ week: 1 }];
    const settings = { tasks: [], personnel: [] };
    expect(splitPayload({ schedule, settings })).toEqual({ schedule, settings });
  });

  it('新格式但沒有 settings 欄位時 settings 為 null', () => {
    const schedule = [{ week: 1 }];
    expect(splitPayload({ schedule })).toEqual({ schedule, settings: null });
  });

  it('新格式但 settings 為 null（匯出時沒有作用中設定檔）時保持 null', () => {
    const schedule = [{ week: 1 }];
    expect(splitPayload({ schedule, settings: null })).toEqual({ schedule, settings: null });
  });
});
