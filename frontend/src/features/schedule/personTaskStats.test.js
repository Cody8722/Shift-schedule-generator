import { describe, it, expect } from 'vitest';
import { computePersonTaskStats, renderPersonTaskStatsHtml } from './personTaskStats.js';

const makeWeek = ({ tasks, schedule, dateRange = '2025-01-06~10', weekIndex }) => ({
  dateRange,
  tasks,
  schedule,
  ...(weekIndex !== undefined ? { weekIndex } : {}),
});

describe('computePersonTaskStats', () => {
  it('沒有資料時回傳 null', () => {
    expect(computePersonTaskStats(null, ['張三'])).toBeNull();
    expect(computePersonTaskStats([], ['張三'])).toBeNull();
  });

  it('正確加總單週各人員在各勤務的次數', () => {
    const week = makeWeek({
      tasks: [{ name: '早班' }, { name: '晚班' }],
      schedule: [
        [['張三'], ['李四']],
        [['張三', '李四'], []],
      ],
    });
    const stats = computePersonTaskStats([week], ['張三', '李四']);
    expect(stats.taskNames).toEqual(['早班', '晚班']);
    expect(stats.total).toEqual({
      張三: { 早班: 2, 晚班: 0 },
      李四: { 早班: 1, 晚班: 1 },
    });
    expect(stats.weeks).toHaveLength(1);
    expect(stats.weeks[0].counts).toEqual(stats.total);
  });

  it('跨多週正確加總，且每週明細各自獨立', () => {
    const weekA = makeWeek({
      tasks: [{ name: '早班' }],
      schedule: [[['張三']], [['張三']]],
      weekIndex: 0,
    });
    const weekB = makeWeek({
      tasks: [{ name: '早班' }],
      schedule: [[['李四']]],
      weekIndex: 1,
    });
    const stats = computePersonTaskStats([weekA, weekB], ['張三', '李四']);
    expect(stats.total).toEqual({ 張三: { 早班: 2 }, 李四: { 早班: 1 } });
    expect(stats.weeks[0].counts).toEqual({ 張三: { 早班: 2 }, 李四: { 早班: 0 } });
    expect(stats.weeks[1].counts).toEqual({ 張三: { 早班: 0 }, 李四: { 早班: 1 } });
  });

  it('目前人員清單中沒有值勤的人仍顯示為 0 次', () => {
    const week = makeWeek({ tasks: [{ name: '早班' }], schedule: [[['張三']]] });
    const stats = computePersonTaskStats([week], ['張三', '王五']);
    expect(stats.total.王五).toEqual({ 早班: 0 });
  });

  it('排班資料中出現不在人員清單的姓名仍照實計入合計', () => {
    const week = makeWeek({ tasks: [{ name: '早班' }], schedule: [[['已離職']]] });
    const stats = computePersonTaskStats([week], ['張三']);
    expect(stats.total.已離職).toEqual({ 早班: 1 });
    expect(stats.total.張三).toEqual({ 早班: 0 });
  });
});

describe('renderPersonTaskStatsHtml', () => {
  it('沒有班表資料時顯示空狀態訊息', () => {
    expect(renderPersonTaskStatsHtml(null, ['張三'])).toContain('尚未產生班表');
  });

  it('只有一週時不重複顯示「每週明細」區塊', () => {
    const week = makeWeek({ tasks: [{ name: '早班' }], schedule: [[['張三']]] });
    const html = renderPersonTaskStatsHtml([week], ['張三']);
    expect(html).toContain('整份班表加總');
    expect(html).not.toContain('每週明細');
  });

  it('多週時顯示每週明細區塊，並包含各週日期範圍', () => {
    const weekA = makeWeek({ tasks: [{ name: '早班' }], schedule: [[['張三']]], dateRange: '08/31-09/04' });
    const weekB = makeWeek({ tasks: [{ name: '早班' }], schedule: [[['李四']]], dateRange: '09/07-09/11' });
    const html = renderPersonTaskStatsHtml([weekA, weekB], ['張三', '李四']);
    expect(html).toContain('每週明細');
    expect(html).toContain('08/31-09/04');
    expect(html).toContain('09/07-09/11');
  });
});
