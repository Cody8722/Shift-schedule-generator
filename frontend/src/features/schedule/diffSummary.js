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
  if (changes.length === 0) {
    content.innerHTML =
      '<p class="text-gray-500 dark:text-gray-400 text-center py-6">目前無任何修改，班表與原始一致。</p>';
  } else {
    content.innerHTML = changes
      .map(
        (c) => `
      <div class="mb-3 pb-3 border-b border-gray-200 dark:border-gray-600 last:border-0">
        <p class="font-medium text-gray-700 dark:text-gray-300 mb-1">${escapeHtml(c.label)}</p>
        ${c.added.map((p) => `<p class="text-green-600 dark:text-green-400 ml-3">＋ ${escapeHtml(p)}</p>`).join('')}
        ${c.removed.map((p) => `<p class="text-red-500 dark:text-red-400 ml-3">－ ${escapeHtml(p)}</p>`).join('')}
      </div>`
      )
      .join('');
  }
  modal.classList.remove('hidden');
};
