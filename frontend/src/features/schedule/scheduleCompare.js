import { escapeHtml } from '../../utils/escapeHtml.js';
import { getActiveProfile } from '../../state/appState.js';
import { buildDiff, renderDiffSection } from './diffSummary.js';

/**
 * 計算單週的填補率（人力需求 vs 實際填補人數）。
 * @param {object} week fullScheduleData 的單週物件
 * @returns {{demand:number, filled:number, pct:number}}
 */
export const computeFillRate = (week) => {
  const tasks = week.tasks || [];
  const scheduleDays = week.scheduleDays || [];
  const workDays = scheduleDays.filter((d) => d.shouldSchedule).length;
  const demand = tasks.reduce((s, t) => s + (t.count || 0), 0) * workDays;
  const filled = tasks.reduce(
    (s, task, ti) =>
      s +
      scheduleDays.reduce(
        (a, day, di) => a + (day.shouldSchedule ? (week.schedule[di]?.[ti]?.length || 0) : 0),
        0
      ),
    0
  );
  const pct = demand > 0 ? Math.round((filled / demand) * 100) : 100;
  return { demand, filled, pct };
};

/**
 * 比較兩週的填補率，回傳有差異的週次清單。
 * @param {Array} a
 * @param {Array} b
 * @param {number} minWeeks
 * @returns {Array<{weekIndex:number, dateRangeA:string, dateRangeB:string, a:object, b:object}>}
 */
export const buildFillRateDiff = (a, b, minWeeks) => {
  const diffs = [];
  for (let i = 0; i < minWeeks; i++) {
    const rateA = computeFillRate(a[i]);
    const rateB = computeFillRate(b[i]);
    if (rateA.demand !== rateB.demand || rateA.filled !== rateB.filled) {
      diffs.push({
        weekIndex: i,
        dateRangeA: a[i].dateRange,
        dateRangeB: b[i].dateRange,
        a: rateA,
        b: rateB,
      });
    }
  }
  return diffs;
};

/**
 * 比較兩週的勤務設定（人數需求／優先序／新增/移除的勤務）。
 * @param {object} weekA
 * @param {object} weekB
 * @returns {Array<{type:'add'|'rem'|'chg', text:string}>}
 */
export const buildTaskSettingsDiff = (weekA, weekB) => {
  const tasksA = weekA.tasks || [];
  const tasksB = weekB.tasks || [];
  const mapA = new Map(tasksA.map((t) => [t.name, t]));
  const mapB = new Map(tasksB.map((t) => [t.name, t]));
  const lines = [];

  for (const [name] of mapA) {
    if (!mapB.has(name)) lines.push({ type: 'rem', text: `移除勤務「${name}」` });
  }
  for (const [name, t] of mapB) {
    if (!mapA.has(name)) lines.push({ type: 'add', text: `新增勤務「${name}」（需 ${t.count} 人）` });
  }
  for (const [name, tA] of mapA) {
    const tB = mapB.get(name);
    if (!tB) continue;
    if (tA.count !== tB.count) {
      lines.push({ type: 'chg', text: `「${name}」需求人數 ${tA.count} → ${tB.count}` });
    }
    if ((tA.priority || 9) !== (tB.priority || 9)) {
      lines.push({ type: 'chg', text: `「${name}」優先序 ${tA.priority || 9} → ${tB.priority || 9}` });
    }
  }
  return lines;
};

/**
 * 比較 minWeeks 範圍內每週的勤務設定差異，回傳有差異的週次清單。
 */
export const buildTaskSettingsDiffByWeek = (a, b, minWeeks) => {
  const result = [];
  for (let i = 0; i < minWeeks; i++) {
    const lines = buildTaskSettingsDiff(a[i], b[i]);
    if (lines.length > 0) {
      result.push({ weekIndex: i, dateRangeA: a[i].dateRange, dateRangeB: b[i].dateRange, lines });
    }
  }
  return result;
};

const renderFillRateDiff = (fillDiffs) => {
  if (fillDiffs.length === 0) {
    return `<div class="diff-empty"><div class="icn">✓</div>填補率沒有差異</div>`;
  }
  return `<div class="diff-list">${fillDiffs
    .map(
      (d) => `
    <div class="diff-group">
      <div class="diff-group-head">
        <span class="week-pill">W${d.weekIndex + 1}</span>
        <span class="label">${escapeHtml(d.dateRangeA)} → ${escapeHtml(d.dateRangeB)}</span>
      </div>
      <div class="diff-changes">
        <div class="diff-line chg"><span class="marker">±</span><span class="person">填補 ${d.a.filled}/${d.a.demand}（${d.a.pct}%） → ${d.b.filled}/${d.b.demand}（${d.b.pct}%）</span></div>
      </div>
    </div>`
    )
    .join('')}</div>`;
};

const renderTaskSettingsDiff = (settingsDiffs) => {
  if (settingsDiffs.length === 0) {
    return `<div class="diff-empty"><div class="icn">✓</div>勤務設定沒有差異</div>`;
  }
  return `<div class="diff-list">${settingsDiffs
    .map(
      (d) => `
    <div class="diff-group">
      <div class="diff-group-head">
        <span class="week-pill">W${d.weekIndex + 1}</span>
        <span class="label">${escapeHtml(d.dateRangeA)} → ${escapeHtml(d.dateRangeB)}</span>
      </div>
      <div class="diff-changes">
        ${d.lines
          .map(
            (l) =>
              `<div class="diff-line ${l.type}"><span class="marker">${l.type === 'add' ? '+' : l.type === 'rem' ? '−' : '±'}</span><span class="person">${escapeHtml(l.text)}</span></div>`
          )
          .join('')}
      </div>
    </div>`
    )
    .join('')}</div>`;
};

/**
 * 產生完整的比較結果 HTML（人員異動 + 填補率差異 + 勤務設定差異）。
 * @param {Array} scheduleA fullScheduleData
 * @param {Array} scheduleB fullScheduleData
 */
export const renderCompareResult = (scheduleA, scheduleB) => {
  const minWeeks = Math.min(scheduleA.length, scheduleB.length);
  const note =
    scheduleA.length !== scheduleB.length
      ? `<div class="compare-note">班表 A 共 ${scheduleA.length} 週、班表 B 共 ${scheduleB.length} 週，僅比較前 ${minWeeks} 週。</div>`
      : '';

  const personnelChanges = buildDiff(scheduleA.slice(0, minWeeks), scheduleB.slice(0, minWeeks));
  const fillDiffs = buildFillRateDiff(scheduleA, scheduleB, minWeeks);
  const settingsDiffs = buildTaskSettingsDiffByWeek(scheduleA, scheduleB, minWeeks);

  return `
    ${note}
    <div class="compare-section-title">人員異動</div>
    ${renderDiffSection(personnelChanges, '兩份班表的人員配置完全相同')}
    <div class="compare-section-title">填補率差異</div>
    ${renderFillRateDiff(fillDiffs)}
    <div class="compare-section-title">勤務設定差異</div>
    ${renderTaskSettingsDiff(settingsDiffs)}
  `;
};

/**
 * 初始化「比較班表」Modal 的事件綁定。
 */
export const initScheduleCompare = () => {
  const btn = document.getElementById('compare-schedules-btn');
  const modal = document.getElementById('compare-modal');
  const selectA = document.getElementById('compare-select-a');
  const selectB = document.getElementById('compare-select-b');
  const runBtn = document.getElementById('compare-run-btn');
  const result = document.getElementById('compare-result');
  const closeBtn = document.getElementById('compare-modal-close-2');
  if (!btn || !modal || !selectA || !selectB || !runBtn || !result) return;

  const populateSelects = () => {
    const schedules = getActiveProfile()?.schedules || {};
    const names = Object.keys(schedules);
    const optionsHtml = names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    selectA.innerHTML = optionsHtml;
    selectB.innerHTML = optionsHtml;
    if (names.length > 1) selectB.selectedIndex = 1;
    result.innerHTML = names.length < 2
      ? '<div class="diff-empty"><div class="icn">i</div>至少要有兩份已儲存的班表才能比較</div>'
      : '';
    runBtn.disabled = names.length < 2;
  };

  btn.addEventListener('click', () => {
    populateSelects();
    modal.classList.add('open');
  });

  closeBtn?.addEventListener('click', () => modal.classList.remove('open'));

  runBtn.addEventListener('click', () => {
    const nameA = selectA.value;
    const nameB = selectB.value;
    if (!nameA || !nameB) return;
    if (nameA === nameB) {
      result.innerHTML = '<div class="diff-empty"><div class="icn">i</div>請選擇兩份不同的班表</div>';
      return;
    }
    const schedules = getActiveProfile()?.schedules || {};
    const scheduleA = schedules[nameA];
    const scheduleB = schedules[nameB];
    if (!scheduleA || !scheduleB) return;
    result.innerHTML = renderCompareResult(scheduleA, scheduleB);
  });
};
