const debug = require('debug');

const debugSchedule = debug('app:schedule');

// [預留功能] 技能分數系統
// 計算人員對特定班次的有效技能分 (0-5)
// 優先使用 taskScores，否則從 preferredTask 推算（向下兼容）
const getEffectiveScore = (person, taskName) => {
  if (person.taskScores && typeof person.taskScores === 'object') {
    const score = person.taskScores[taskName];
    if (typeof score === 'number') return score;
    return 1; // taskScores 存在但無此班次的條目 → 低分
  }
  if (!person.preferredTask) return 3;             // 無偏好 → 中性
  if (person.preferredTask === taskName) return 4; // 偏好此班次
  return 2;                                        // 偏好其他班次
};

const generateWeeklySchedule = (settings, scheduleDays, cumulativeShifts = new Map()) => {
  const { personnel, tasks } = settings;
  const weeklySchedule = Array(5).fill(null).map(() =>
    Array(tasks.length).fill(null).map(() => [])
  );
  const shiftCounts = new Map(personnel.map((p) => [p.name, 0]));
  // 每天已分配的人（同一天不重複排）
  const dailyAssigned = new Map(scheduleDays.map((_, i) => [i, new Set()]));

  const workDays = [0, 1, 2, 3, 4].filter((i) => scheduleDays[i].shouldSchedule);

  // 任務依優先級排序（數字小 = 優先級高，未設定視為 9）
  const tasksByPriority = tasks
    .map((t, i) => ({ ...t, taskIndex: i }))
    .sort((a, b) => (a.priority || 9) - (b.priority || 9));

  // 建立 slot 清單：高優先級的所有 slot 排在前面
  // 同一任務內，以「每天各輪一次」的方式交替，確保每天都有機會被填
  const slots = [];
  for (const { taskIndex, count } of tasksByPriority) {
    for (let slotIndex = 0; slotIndex < count; slotIndex++) {
      const shuffledDays = [...workDays];
      for (let i = shuffledDays.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledDays[i], shuffledDays[j]] = [shuffledDays[j], shuffledDays[i]];
      }
      for (const dayIndex of shuffledDays) {
        slots.push({ dayIndex, taskIndex });
      }
    }
  }

  // 逐一填補每個 slot
  for (const { dayIndex, taskIndex } of slots) {
    const task = tasks[taskIndex];
    const assigned = dailyAssigned.get(dayIndex);

    // 可用人員：未超班次上限、非休假、今天尚未被排
    const available = personnel.filter(
      (p) =>
        !p.offDays?.includes(dayIndex) &&
        (shiftCounts.get(p.name) || 0) < (p.maxShifts || 5) &&
        !assigned.has(p.name)
    );
    if (available.length === 0) continue;

    // 排序：跨週累積最少 → 本週已排最少 → 技能分 + 隨機
    available.sort((a, b) => {
      const cumDiff =
        (cumulativeShifts.get(a.name) || 0) - (cumulativeShifts.get(b.name) || 0);
      if (cumDiff !== 0) return cumDiff;
      const usedDiff = (shiftCounts.get(a.name) || 0) - (shiftCounts.get(b.name) || 0);
      if (usedDiff !== 0) return usedDiff;
      const scoreA = (getEffectiveScore(a, task.name) / 5) * 0.6 + Math.random() * 0.4;
      const scoreB = (getEffectiveScore(b, task.name) / 5) * 0.6 + Math.random() * 0.4;
      return scoreB - scoreA;
    });

    const person = available[0];
    weeklySchedule[dayIndex][taskIndex].push(person.name);
    shiftCounts.set(person.name, (shiftCounts.get(person.name) || 0) + 1);
    assigned.add(person.name);
  }

  // 計算每個任務的填補率，方便診斷
  const fillStats = tasks.map((task, taskIndex) => {
    const needed = workDays.length * (task.count || 1);
    const filled = workDays.reduce(
      (sum, dayIndex) => sum + weeklySchedule[dayIndex][taskIndex].length,
      0
    );
    return { name: task.name, priority: task.priority || 9, needed, filled, ok: filled === needed };
  });

  const unfilled = fillStats.filter((s) => !s.ok);
  if (unfilled.length > 0) {
    debugSchedule(
      '未填滿的勤務:',
      unfilled.map((s) => `${s.name}(優先${s.priority}) ${s.filled}/${s.needed}`).join(', ')
    );
    debugSchedule('人員班次分佈:', Object.fromEntries(shiftCounts));
  }

  return { weeklySchedule, fillStats, weekShiftCounts: shiftCounts };
};

module.exports = { getEffectiveScore, generateWeeklySchedule };
