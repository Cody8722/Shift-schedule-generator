import { escapeHtml } from '../../utils/escapeHtml.js';
import { showToast } from '../../ui/toast.js';
import {
  getEditingData,
  getGeneratedData,
  getSelectedWeeks,
  setSelectedWeeks,
} from '../../state/appState.js';

/**
 * 取得目前要匯出的資料：依「匯出週次」勾選篩選，並在每週物件標記原始週次
 * （weekIndex），讓匯出結果的 W 標籤不會因為只匯出部分週而錯位。
 * @returns {Array|null}
 */
export const getExportData = () => {
  const data = getEditingData() || getGeneratedData();
  if (!data) return null;
  const selected = getSelectedWeeks();
  return data
    .map((week, i) => ({ ...week, weekIndex: i }))
    .filter((week) => selected.has(week.weekIndex));
};

/**
 * 重新渲染匯出週次的勾選 chip（依 getGeneratedData() 的週數與目前選取狀態）。
 * 只有 2 週以上才顯示，單週班表不需要篩選。
 */
export const renderExportWeekFilter = () => {
  const container = document.getElementById('export-week-filter');
  const chipsEl = document.getElementById('week-filter-chips');
  if (!container || !chipsEl) return;

  const generatedData = getGeneratedData();
  if (!generatedData || generatedData.length <= 1) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  const selected = getSelectedWeeks();
  chipsEl.innerHTML = generatedData
    .map(
      (week, i) => `
      <button type="button" class="week-chip ${selected.has(i) ? 'on' : ''}" data-week-index="${i}" title="${escapeHtml(week.dateRange)}">W${i + 1}</button>`
    )
    .join('');
};

/**
 * 綁定 chip 點擊事件（只需呼叫一次）。
 */
export const initExportWeekFilter = () => {
  const chipsEl = document.getElementById('week-filter-chips');
  chipsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.week-chip');
    if (!btn) return;
    const i = parseInt(btn.dataset.weekIndex, 10);
    const selected = new Set(getSelectedWeeks());
    if (selected.has(i)) {
      if (selected.size === 1) {
        showToast('至少要保留一週', 'warning');
        return;
      }
      selected.delete(i);
    } else {
      selected.add(i);
    }
    setSelectedWeeks(selected);
    renderExportWeekFilter();
  });
};
