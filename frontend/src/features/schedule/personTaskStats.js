import { escapeHtml } from '../../utils/escapeHtml.js';
import { getEditingData, getGeneratedData, getActiveProfile } from '../../state/appState.js';

/**
 * 計算「人員 × 勤務」的值勤次數統計：整份班表加總，以及每週明細。
 * @param {Array} data fullScheduleData（可為全部週，或已依週次篩選過的資料）
 * @param {Array<string>} personNames 要統計的人員名單（決定列的顯示順序，含 0 次的人）
 * @returns {{taskNames: string[], total: Record<string, Record<string, number>>, weeks: Array<{weekIndex:number, dateRange:string, counts: Record<string, Record<string, number>>}>} | null}
 */
export const computePersonTaskStats = (data, personNames) => {
  if (!data || data.length === 0) return null;

  const taskNames = data[0].tasks.map((t) => t.name);

  const makeEmptyCounts = () => {
    const counts = {};
    personNames.forEach((p) => {
      counts[p] = {};
      taskNames.forEach((t) => { counts[p][t] = 0; });
    });
    return counts;
  };
  // 資料裡若出現不在目前人員清單的姓名（例如已從設定移除），仍照實計入，
  // 避免總數比實際排班次數少，看起來像漏算。
  const ensurePerson = (counts, name) => {
    if (!counts[name]) {
      counts[name] = {};
      taskNames.forEach((t) => { counts[name][t] = 0; });
    }
  };

  const total = makeEmptyCounts();
  const weeks = data.map((week, i) => {
    const counts = makeEmptyCounts();
    (week.schedule || []).forEach((daySlots) => {
      daySlots.forEach((persons, ti) => {
        const taskName = week.tasks?.[ti]?.name;
        if (!taskName) return;
        persons.forEach((personName) => {
          ensurePerson(counts, personName);
          ensurePerson(total, personName);
          counts[personName][taskName] = (counts[personName][taskName] || 0) + 1;
          total[personName][taskName] = (total[personName][taskName] || 0) + 1;
        });
      });
    });
    return { weekIndex: week.weekIndex ?? i, dateRange: week.dateRange, counts };
  });

  return { taskNames, total, weeks };
};

const rowOrder = (personNames, counts) => {
  const extra = Object.keys(counts).filter((p) => !personNames.includes(p));
  return [...personNames, ...extra];
};

const renderStatsTable = (personNames, taskNames, counts) => {
  const order = rowOrder(personNames, counts);
  const headerCells = taskNames.map((t) => `<th>${escapeHtml(t)}</th>`).join('');
  const rows = order
    .map((p) => {
      const rowTotal = taskNames.reduce((s, t) => s + (counts[p]?.[t] || 0), 0);
      const cells = taskNames.map((t) => `<td>${counts[p]?.[t] || 0}</td>`).join('');
      return `<tr><td class="stats-person">${escapeHtml(p)}</td>${cells}<td class="stats-total">${rowTotal}</td></tr>`;
    })
    .join('');
  return `
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead><tr><th class="stats-person">人員</th>${headerCells}<th class="stats-total">合計</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
};

/**
 * 渲染「值勤統計」內容（整份班表加總 + 每週明細），供 Modal 與 PDF 匯出共用。
 */
export const renderPersonTaskStatsHtml = (data, personNames) => {
  const stats = computePersonTaskStats(data, personNames);
  if (!stats) return '<div class="diff-empty"><div class="icn">i</div>尚未產生班表</div>';

  const totalSection = `
    <div class="compare-section-title">整份班表加總（共 ${stats.weeks.length} 週）</div>
    ${renderStatsTable(personNames, stats.taskNames, stats.total)}
  `;

  // 只有一週時，每週明細會跟加總完全一樣，省略避免重複。
  const weeklySection =
    stats.weeks.length > 1
      ? `
    <div class="compare-section-title">每週明細</div>
    <div class="diff-list">
      ${stats.weeks
        .map(
          (w) => `
        <div class="diff-group">
          <div class="diff-group-head">
            <span class="week-pill">W${w.weekIndex + 1}</span>
            <span class="label">${escapeHtml(w.dateRange || '')}</span>
          </div>
          <div class="diff-changes">${renderStatsTable(personNames, stats.taskNames, w.counts)}</div>
        </div>`
        )
        .join('')}
    </div>`
      : '';

  return totalSection + weeklySection;
};

/**
 * 初始化「值勤統計」Modal 的事件綁定。
 */
export const initPersonTaskStats = () => {
  const btn = document.getElementById('person-task-stats-btn');
  const modal = document.getElementById('person-task-stats-modal');
  const body = document.getElementById('person-task-stats-body');
  const closeBtn = document.getElementById('person-task-stats-close-2');
  if (!btn || !modal || !body) return;

  btn.addEventListener('click', () => {
    const data = getEditingData() || getGeneratedData();
    const personNames = (getActiveProfile()?.settings?.personnel || []).map((p) => p.name);
    body.innerHTML = renderPersonTaskStatsHtml(data, personNames);
    modal.classList.add('open');
  });

  closeBtn?.addEventListener('click', () => modal.classList.remove('open'));
};
