import { describe, it, expect } from 'vitest';
import { buildDiff } from './diffSummary.js';

// ── 測試資料工廠 ─────────────────────────────────────────────────────────────

const makeScheduleDays = (flags = [true, true, true, true, true]) =>
  flags.map((shouldSchedule) => ({ shouldSchedule }));

/** 建立 dayCount × taskCount 的班表，每個 slot 填入 people 的副本 */
const makeSchedule = (people, taskCount = 1, dayCount = 5) =>
  Array.from({ length: dayCount }, () =>
    Array.from({ length: taskCount }, () => [...people])
  );

const baseWeek = () => ({
  dateRange: '2025-01-06~10',
  tasks: [{ name: '早班' }],
  scheduleDays: makeScheduleDays(),
  schedule: makeSchedule(['張三']),
});

const clone = (obj) => JSON.parse(JSON.stringify(obj));

// ── buildDiff ────────────────────────────────────────────────────────────────

describe('buildDiff', () => {
  it('無變更時回傳空陣列', () => {
    const week = baseWeek();
    expect(buildDiff([week], [clone(week)])).toHaveLength(0);
  });

  it('新增人員時 added 包含該人員', () => {
    const original = [baseWeek()];
    const current = clone(original);
    current[0].schedule[0][0] = ['張三', '李四'];
    const changes = buildDiff(original, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].added).toContain('李四');
    expect(changes[0].removed).toHaveLength(0);
  });

  it('移除人員時 removed 包含該人員', () => {
    const original = [baseWeek()];
    const current = clone(original);
    current[0].schedule[0][0] = [];
    const changes = buildDiff(original, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].removed).toContain('張三');
    expect(changes[0].added).toHaveLength(0);
  });

  it('同時有新增與移除時 added/removed 均正確', () => {
    const original = [baseWeek()];
    const current = clone(original);
    current[0].schedule[0][0] = ['李四']; // replace 張三 with 李四
    const [change] = buildDiff(original, current);
    expect(change.added).toContain('李四');
    expect(change.removed).toContain('張三');
  });

  it('休假日（shouldSchedule=false）跳過，不計入差異', () => {
    const original = [baseWeek()];
    original[0].scheduleDays[0].shouldSchedule = false;
    const current = clone(original);
    current[0].schedule[0][0] = ['李四']; // different person, but off day
    expect(buildDiff(original, current)).toHaveLength(0);
  });

  it('多週時各週差異分別回報', () => {
    const week1 = baseWeek();
    const week2 = { ...baseWeek(), dateRange: '2025-01-13~17' };
    const original = [week1, week2];
    const current = clone(original);
    current[0].schedule[0][0] = [];               // week 1, day 0: remove 張三
    current[1].schedule[0][0] = ['張三', '王五']; // week 2, day 0: add 王五
    const changes = buildDiff(original, current);
    expect(changes).toHaveLength(2);
  });

  it('label 包含正確週次、日期範圍、星期、勤務名稱', () => {
    const original = [baseWeek()];
    const current = clone(original);
    current[0].schedule[0][0] = [];
    const [change] = buildDiff(original, current);
    expect(change.label).toContain('第 1 週');
    expect(change.label).toContain('2025-01-06~10');
    expect(change.label).toContain('週一');
    expect(change.label).toContain('早班');
  });

  it('第二週的 label 包含「第 2 週」', () => {
    const week2 = { ...baseWeek(), dateRange: '2025-01-13~17' };
    const original = [baseWeek(), week2];
    const current = clone(original);
    current[1].schedule[0][0] = [];
    const changes = buildDiff(original, current);
    const week2Changes = changes.filter((c) => c.label.includes('第 2 週'));
    expect(week2Changes).toHaveLength(1);
  });

  it('多勤務時依勤務 index 區分，label 含正確勤務名稱', () => {
    const twoTaskWeek = {
      dateRange: '2025-01-06~10',
      tasks: [{ name: '早班' }, { name: '午班' }],
      scheduleDays: makeScheduleDays(),
      schedule: makeSchedule(['張三'], 2),
    };
    const original = [twoTaskWeek];
    const current = clone(original);
    current[0].schedule[0][1] = []; // day 0, task 1 (午班): remove 張三
    const changes = buildDiff(original, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].label).toContain('午班');
  });

  it('週三（index 2）的 label 包含「週三」', () => {
    const original = [baseWeek()];
    const current = clone(original);
    current[0].schedule[2][0] = []; // Wednesday
    const [change] = buildDiff(original, current);
    expect(change.label).toContain('週三');
  });

  it('current 對應 slot 缺失時視為空 slot（removed 全部原人員）', () => {
    const original = [baseWeek()];
    const current = clone(original);
    // Simulate missing task slot by setting it to undefined
    current[0].schedule[0][0] = undefined;
    const changes = buildDiff(original, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].removed).toContain('張三');
  });
});
