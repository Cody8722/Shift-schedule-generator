'use strict';

const { generateScheduleHtml } = require('../../src/services/scheduleRenderer');

const makeWeek = (overrides = {}) => ({
  schedule: [[['張三']]],
  tasks: [{ name: '早班', count: 1, priority: 1 }],
  dateRange: '01/06',
  weekDayDates: ['01/06'],
  scheduleDays: [{ shouldSchedule: true, description: '' }],
  color: { header: '#0284c7', row: '#f0f9ff' },
  fillStats: [],
  ...overrides,
});

describe('generateScheduleHtml', () => {
  it('回傳包含 week-block 的 HTML 字串', () => {
    const html = generateScheduleHtml([makeWeek()]);
    expect(typeof html).toBe('string');
    expect(html).toContain('week-block');
    expect(html).toContain('早班');
    expect(html).toContain('張三');
  });

  it('假日欄位（shouldSchedule=false）產生 holiday-cell', () => {
    const week = makeWeek({
      schedule: [[['張三']]],
      scheduleDays: [{ shouldSchedule: false, description: '元旦' }],
    });
    const html = generateScheduleHtml([week]);
    expect(html).toContain('holiday-cell');
    expect(html).toContain('元旦');
  });

  it('空人員（personName 為空）產生 warn-cell', () => {
    const week = makeWeek({
      schedule: [[['']]], // 空名稱 → unfilled
      scheduleDays: [{ shouldSchedule: true, description: '' }],
    });
    const html = generateScheduleHtml([week]);
    expect(html).toContain('warn-cell');
    expect(html).toContain('待補');
  });

  it('多週時每週都有對應 id', () => {
    const html = generateScheduleHtml([makeWeek(), makeWeek()]);
    expect(html).toContain('schedule-week-0');
    expect(html).toContain('schedule-week-1');
  });

  it('需求量為 0 時 pct 預設 100（不除零）', () => {
    const week = makeWeek({
      tasks: [{ name: '空班', count: 0, priority: 1 }],
      schedule: [[[]]],
    });
    const html = generateScheduleHtml([week]);
    expect(html).toContain('100%');
  });
});
