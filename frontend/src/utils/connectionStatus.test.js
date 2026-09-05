import { describe, it, expect } from 'vitest';
import { buildAutoFetchWarnings } from './connectionStatus.js';

describe('buildAutoFetchWarnings', () => {
  it('所有年份都成功、學校行事曆無警告時回傳空陣列', () => {
    const data = {
      holidaysLastRefresh: { years: { 2026: { success: true, count: 16 } } },
      schoolCalendarLastFetch: { success: true, warning: null },
    };
    expect(buildAutoFetchWarnings(data)).toEqual([]);
  });

  it('某年份更新失敗時回傳對應原因', () => {
    const data = {
      holidaysLastRefresh: { years: { 2026: { success: false, error: 'CDN 逾時' } } },
      schoolCalendarLastFetch: { success: true, warning: null },
    };
    const reasons = buildAutoFetchWarnings(data);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('2026');
    expect(reasons[0]).toContain('CDN 逾時');
  });

  it('多個年份失敗時每個都回傳一筆原因', () => {
    const data = {
      holidaysLastRefresh: {
        years: {
          2026: { success: false, error: 'timeout' },
          2027: { success: false, error: 'timeout' },
        },
      },
    };
    expect(buildAutoFetchWarnings(data)).toHaveLength(2);
  });

  it('學校行事曆有 warning 時加入原因清單', () => {
    const data = {
      holidaysLastRefresh: { years: {} },
      schoolCalendarLastFetch: { success: false, warning: '本次即時抓取沒有找到任何考試資料' },
    };
    const reasons = buildAutoFetchWarnings(data);
    expect(reasons).toContain('本次即時抓取沒有找到任何考試資料');
  });

  it('缺少 holidaysLastRefresh/schoolCalendarLastFetch 欄位時不拋出例外，回傳空陣列', () => {
    expect(buildAutoFetchWarnings({})).toEqual([]);
    expect(buildAutoFetchWarnings(null)).toEqual([]);
    expect(buildAutoFetchWarnings(undefined)).toEqual([]);
  });
});
