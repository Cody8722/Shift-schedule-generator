import { describe, it, expect } from 'vitest';
import { computeFillRate, buildFillRateDiff, buildTaskSettingsDiff, buildTaskSettingsDiffByWeek } from './scheduleCompare.js';

const makeScheduleDays = (flags = [true, true, true, true, true]) =>
  flags.map((shouldSchedule) => ({ shouldSchedule }));

const makeWeek = ({ tasks, scheduleDays, schedule, dateRange = '2025-01-06~10' }) => ({
  dateRange,
  tasks,
  scheduleDays: scheduleDays || makeScheduleDays(),
  schedule,
});

describe('computeFillRate', () => {
  it('全部填滿時 pct 為 100', () => {
    const week = makeWeek({
      tasks: [{ name: '早班', count: 1 }],
      schedule: Array.from({ length: 5 }, () => [['張三']]),
    });
    expect(computeFillRate(week)).toEqual({ demand: 5, filled: 5, pct: 100 });
  });

  it('部分未填時 pct 反映實際比例', () => {
    const week = makeWeek({
      tasks: [{ name: '早班', count: 2 }],
      schedule: Array.from({ length: 5 }, () => [['張三']]), // 每天只有 1 人，需求 2 人
    });
    expect(computeFillRate(week)).toEqual({ demand: 10, filled: 5, pct: 50 });
  });

  it('休假日不計入需求與填補', () => {
    const week = makeWeek({
      tasks: [{ name: '早班', count: 1 }],
      scheduleDays: makeScheduleDays([true, false, true, true, true]),
      schedule: [['張三'], ['李四'], ['張三'], ['張三'], ['張三']].map((p) => [p]),
    });
    expect(computeFillRate(week)).toEqual({ demand: 4, filled: 4, pct: 100 });
  });

  it('demand 為 0 時 pct 視為 100', () => {
    const week = makeWeek({ tasks: [], schedule: Array.from({ length: 5 }, () => []) });
    expect(computeFillRate(week).pct).toBe(100);
  });
});

describe('buildFillRateDiff', () => {
  it('填補率相同時不回報差異', () => {
    const week = makeWeek({
      tasks: [{ name: '早班', count: 1 }],
      schedule: Array.from({ length: 5 }, () => [['張三']]),
    });
    expect(buildFillRateDiff([week], [week], 1)).toHaveLength(0);
  });

  it('填補人數不同時回報差異', () => {
    const weekA = makeWeek({
      tasks: [{ name: '早班', count: 1 }],
      schedule: Array.from({ length: 5 }, () => [['張三']]),
    });
    const weekB = makeWeek({
      tasks: [{ name: '早班', count: 1 }],
      schedule: [[], ['張三'], ['張三'], ['張三'], ['張三']].map((p) => [p]),
    });
    const diffs = buildFillRateDiff([weekA], [weekB], 1);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].a.filled).toBe(5);
    expect(diffs[0].b.filled).toBe(4);
  });
});

describe('buildTaskSettingsDiff', () => {
  it('完全相同時回傳空陣列', () => {
    const week = { tasks: [{ name: '早班', count: 2, priority: 1 }] };
    expect(buildTaskSettingsDiff(week, week)).toHaveLength(0);
  });

  it('人數變動回報 chg', () => {
    const weekA = { tasks: [{ name: '早班', count: 2, priority: 1 }] };
    const weekB = { tasks: [{ name: '早班', count: 3, priority: 1 }] };
    const lines = buildTaskSettingsDiff(weekA, weekB);
    expect(lines).toEqual([{ type: 'chg', text: '「早班」需求人數 2 → 3' }]);
  });

  it('優先序變動回報 chg', () => {
    const weekA = { tasks: [{ name: '早班', count: 2, priority: 1 }] };
    const weekB = { tasks: [{ name: '早班', count: 2, priority: 3 }] };
    const lines = buildTaskSettingsDiff(weekA, weekB);
    expect(lines).toEqual([{ type: 'chg', text: '「早班」優先序 1 → 3' }]);
  });

  it('新增與移除的勤務分別回報 add/rem', () => {
    const weekA = { tasks: [{ name: '早班', count: 1, priority: 1 }] };
    const weekB = { tasks: [{ name: '晚班', count: 2, priority: 1 }] };
    const lines = buildTaskSettingsDiff(weekA, weekB);
    expect(lines).toContainEqual({ type: 'rem', text: '移除勤務「早班」' });
    expect(lines).toContainEqual({ type: 'add', text: '新增勤務「晚班」（需 2 人）' });
  });
});

describe('buildTaskSettingsDiffByWeek', () => {
  it('只回報有差異的週次', () => {
    const same = { tasks: [{ name: '早班', count: 1, priority: 1 }], dateRange: 'W1' };
    const changed = { tasks: [{ name: '早班', count: 2, priority: 1 }], dateRange: 'W2' };
    const a = [same, { tasks: [{ name: '早班', count: 1, priority: 1 }], dateRange: 'W2' }];
    const b = [same, changed];
    const result = buildTaskSettingsDiffByWeek(a, b, 2);
    expect(result).toHaveLength(1);
    expect(result[0].weekIndex).toBe(1);
  });
});
