'use strict';

const { getEffectiveScore, generateWeeklySchedule } = require('../src/services/scheduleAlgorithm');

// ─── 工具函式 ─────────────────────────────────────────────────────────────

const makeDays = (flags = [true, true, true, true, true]) =>
  flags.map((shouldSchedule) => ({ shouldSchedule }));

const allDays = makeDays();

// ─── getEffectiveScore ─────────────────────────────────────────────────────

describe('getEffectiveScore', () => {
  it('有 taskScores 且有該班次時回傳對應分數', () => {
    const person = { taskScores: { 早班: 4 } };
    expect(getEffectiveScore(person, '早班')).toBe(4);
  });

  it('有 taskScores 但無該班次條目時回傳低分 1', () => {
    const person = { taskScores: { 午班: 3 } };
    expect(getEffectiveScore(person, '早班')).toBe(1);
  });

  it('無 taskScores 且無 preferredTask 時回傳中性分 3', () => {
    const person = {};
    expect(getEffectiveScore(person, '早班')).toBe(3);
  });

  it('preferredTask 符合時回傳 4', () => {
    const person = { preferredTask: '早班' };
    expect(getEffectiveScore(person, '早班')).toBe(4);
  });

  it('preferredTask 不符合時回傳 2', () => {
    const person = { preferredTask: '午班' };
    expect(getEffectiveScore(person, '早班')).toBe(2);
  });
});

// ─── generateWeeklySchedule ───────────────────────────────────────────────

describe('generateWeeklySchedule', () => {
  const settings = {
    tasks: [{ name: '早班', count: 1 }],
    personnel: [
      { name: '張三', maxShifts: 5 },
      { name: '李四', maxShifts: 5 },
    ],
  };

  it('回傳正確結構（weeklySchedule, fillStats, weekShiftCounts）', () => {
    const result = generateWeeklySchedule(settings, allDays);
    expect(result).toHaveProperty('weeklySchedule');
    expect(result).toHaveProperty('fillStats');
    expect(result).toHaveProperty('weekShiftCounts');
  });

  it('weeklySchedule 是 5x(tasks.length) 的二維陣列', () => {
    const result = generateWeeklySchedule(settings, allDays);
    expect(result.weeklySchedule).toHaveLength(5);
    result.weeklySchedule.forEach((day) => {
      expect(day).toHaveLength(settings.tasks.length);
    });
  });

  it('fillStats 包含每個任務的統計', () => {
    const result = generateWeeklySchedule(settings, allDays);
    expect(result.fillStats).toHaveLength(settings.tasks.length);
    const [stat] = result.fillStats;
    expect(stat).toHaveProperty('name', '早班');
    expect(stat).toHaveProperty('needed');
    expect(stat).toHaveProperty('filled');
    expect(stat).toHaveProperty('ok');
  });

  it('排班後人員不超過 maxShifts', () => {
    const s = {
      tasks: [{ name: '早班', count: 1 }],
      personnel: [{ name: '張三', maxShifts: 2 }, { name: '李四', maxShifts: 2 }],
    };
    const result = generateWeeklySchedule(s, allDays);
    for (const [, count] of result.weekShiftCounts) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('同一天不重複排同一人', () => {
    const s = {
      tasks: [{ name: '早班', count: 1 }, { name: '午班', count: 1 }],
      personnel: [
        { name: '張三', maxShifts: 5 },
        { name: '李四', maxShifts: 5 },
      ],
    };
    const result = generateWeeklySchedule(s, allDays);
    for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
      const peopleToday = result.weeklySchedule[dayIndex].flat();
      const unique = new Set(peopleToday);
      expect(unique.size).toBe(peopleToday.length);
    }
  });

  it('休假日（shouldSchedule=false）不排人', () => {
    const days = makeDays([false, true, true, true, true]);
    const result = generateWeeklySchedule(settings, days);
    const mondaySlots = result.weeklySchedule[0];
    mondaySlots.forEach((slot) => expect(slot).toHaveLength(0));
  });

  it('offDays 的人員在該天不被排', () => {
    const s = {
      tasks: [{ name: '早班', count: 1 }],
      personnel: [{ name: '張三', maxShifts: 5, offDays: [0] }], // 週一休
    };
    const result = generateWeeklySchedule(s, allDays);
    // 週一（index 0）不應有張三
    expect(result.weeklySchedule[0][0]).not.toContain('張三');
  });

  it('人員不足時 fillStats.ok 為 false', () => {
    const s = {
      tasks: [{ name: '早班', count: 5 }], // 每天需要 5 人
      personnel: [{ name: '張三', maxShifts: 5 }], // 只有 1 人
    };
    const result = generateWeeklySchedule(s, allDays);
    expect(result.fillStats[0].ok).toBe(false);
    expect(result.fillStats[0].filled).toBeLessThan(result.fillStats[0].needed);
  });

  it('cumulativeShifts 影響排班順序（少的人優先）', () => {
    const s = {
      tasks: [{ name: '早班', count: 1 }],
      personnel: [
        { name: '張三', maxShifts: 5 },
        { name: '李四', maxShifts: 5 },
      ],
    };
    // 張三已累積 10 次，李四 0 次 → 李四應更常被選中
    const cumulativeShifts = new Map([['張三', 10], ['李四', 0]]);
    const result = generateWeeklySchedule(s, allDays, cumulativeShifts);
    const 李四Count = result.weekShiftCounts.get('李四') || 0;
    const 張三Count = result.weekShiftCounts.get('張三') || 0;
    expect(李四Count).toBeGreaterThanOrEqual(張三Count);
  });

  it('全部人員均休假時所有 slot 為空', () => {
    const s = {
      tasks: [{ name: '早班', count: 1 }],
      personnel: [{ name: '張三', maxShifts: 5, offDays: [0, 1, 2, 3, 4] }],
    };
    const result = generateWeeklySchedule(s, allDays);
    result.weeklySchedule.forEach((day) =>
      day.forEach((slot) => expect(slot).toHaveLength(0))
    );
  });

  it('多任務時 fillStats 長度等於任務數', () => {
    const s = {
      tasks: [
        { name: '早班', count: 1 },
        { name: '午班', count: 1 },
        { name: '晚班', count: 1 },
      ],
      personnel: [
        { name: 'A', maxShifts: 5 },
        { name: 'B', maxShifts: 5 },
        { name: 'C', maxShifts: 5 },
      ],
    };
    const result = generateWeeklySchedule(s, allDays);
    expect(result.fillStats).toHaveLength(3);
  });

  it('weekShiftCounts 是 Map，且包含所有人員', () => {
    const result = generateWeeklySchedule(settings, allDays);
    expect(result.weekShiftCounts).toBeInstanceOf(Map);
    settings.personnel.forEach((p) => {
      expect(result.weekShiftCounts.has(p.name)).toBe(true);
    });
  });
});
