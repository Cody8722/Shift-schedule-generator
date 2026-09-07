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

  it('task.priority 帶惡意字串時會被轉義，不會產生可執行的標籤', () => {
    const payload = '"><img src=x onerror=alert(1)>';
    const week = makeWeek({ tasks: [{ name: '早班', count: 1, priority: payload }] });
    const html = generateScheduleHtml([week]);
    expect(html).not.toContain(payload);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('task.count 帶惡意字串時會被轉義，不會產生可執行的標籤', () => {
    const payload = '<script>alert(1)</script>';
    const week = makeWeek({ tasks: [{ name: '早班', count: payload, priority: 1 }] });
    const html = generateScheduleHtml([week]);
    expect(html).not.toContain(payload);
    expect(html).toContain('&lt;script&gt;');
  });

  it('task.priority 為合法數字時不受轉義影響，正常顯示', () => {
    const week = makeWeek({ tasks: [{ name: '早班', count: 1, priority: 3 }] });
    const html = generateScheduleHtml([week]);
    expect(html).toContain('p3');
    expect(html).toContain('P3');
  });

  it('假日 description 為陣列時不能繞過轉義（曾經是真實可利用的漏洞：陣列 toString 會跳過 escapeHtml）', () => {
    const week = makeWeek({
      schedule: [[[]]],
      scheduleDays: [{ shouldSchedule: false, description: ['<img src=x onerror=alert(1)>'] }],
    });
    const html = generateScheduleHtml([week]);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('人員姓名（schedule 內容）為陣列時不能繞過轉義', () => {
    // schedule[day][task][pi] 本身是陣列（不是字串）——正是實際攻擊測試中
    // 繞過驗證＋轉義的手法：personName = ['<img...>']，樣板字串插值時
    // 陣列的 toString() 會把內容原樣接進 HTML。
    const week = makeWeek({
      schedule: [[[['<img src=x onerror=alert(1)>']]]],
    });
    const html = generateScheduleHtml([week]);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });
});
