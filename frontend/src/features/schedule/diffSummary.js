import { escapeHtml } from '../../utils/escapeHtml.js';
import { getGeneratedData, getEditingData } from '../../state/appState.js';

/**
 * 比對原始班表與當前編輯班表的差異。
 * @param {Array} original
 * @param {Array} current
 * @returns {Array<{label:string, added:string[], removed:string[]}>}
 */
export const buildDiff = (original, current) => {
  const changes = [];
  const dayNames = ['週一', '週二', '週三', '週四', '週五'];
  original.forEach((week, wi) => {
    week.schedule.forEach((daySlots, di) => {
      if (!week.scheduleDays[di].shouldSchedule) return;
      daySlots.forEach((origPersons, ti) => {
        const currPersons = current[wi]?.schedule[di]?.[ti] || [];
        const added = currPersons.filter((p) => !origPersons.includes(p));
        const removed = origPersons.filter((p) => !currPersons.includes(p));
        if (added.length || removed.length) {
          changes.push({
            label: `第 ${wi + 1} 週 ${week.dateRange} / ${dayNames[di]} / ${week.tasks[ti].name}`,
            added,
            removed,
          });
        }
      });
    });
  });
  return changes;
};

/**
 * 將 buildDiff() 的結果渲染成分組列表（人員新增/移除），供多處 Modal 共用。
 * @param {Array<{label:string, added:string[], removed:string[]}>} changes
 * @param {string} emptyText
 * @returns {string}
 */
export const renderDiffSection = (changes, emptyText = '目前無任何差異') => {
  if (changes.length === 0) {
    return `<div class="diff-empty"><div class="icn">✓</div>${escapeHtml(emptyText)}</div>`;
  }
  const totalAdd = changes.reduce((s, c) => s + c.added.length, 0);
  const totalRem = changes.reduce((s, c) => s + c.removed.length, 0);
  const summary = `
    <div class="diff-summary">
      <span class="pill add"><span class="dot"></span>新增 <strong>${totalAdd}</strong></span>
      <span class="pill rem"><span class="dot"></span>移除 <strong>${totalRem}</strong></span>
    </div>`;
  const list = `<div class="diff-list">${changes
    .map((c) => {
      const weekMatch = c.label.match(/^第\s*(\d+)\s*週/);
      const pill = weekMatch ? `<span class="week-pill">W${weekMatch[1]}</span>` : '';
      return `
    <div class="diff-group">
      <div class="diff-group-head">
        ${pill}
        <span class="label">${escapeHtml(c.label)}</span>
      </div>
      <div class="diff-changes">
        ${c.added.map((p) => `<div class="diff-line add"><span class="marker">+</span><span class="person">${escapeHtml(p)}</span></div>`).join('')}
        ${c.removed.map((p) => `<div class="diff-line rem"><span class="marker">−</span><span class="person">${escapeHtml(p)}</span></div>`).join('')}
      </div>
    </div>`;
    })
    .join('')}</div>`;
  return summary + list;
};

/**
 * 開啟差異摘要 Modal。
 */
export const showDiffModal = () => {
  const modal = document.getElementById('diff-modal');
  const content = document.getElementById('diff-modal-content');
  if (!modal || !content) return;

  const original = getGeneratedData();
  const current = getEditingData();
  if (!original || !current) return;

  const changes = buildDiff(original, current);
  const total = changes.reduce((s, c) => s + c.added.length + c.removed.length, 0);
  const dmTotal = document.getElementById('dm-total');
  if (dmTotal) dmTotal.textContent = total;

  content.innerHTML = renderDiffSection(changes, '目前無任何修改，班表與原始一致。');
  modal.classList.add('open');
};
