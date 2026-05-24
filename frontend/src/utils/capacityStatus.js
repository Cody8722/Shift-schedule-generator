import { getActiveProfile } from '../state/appState.js';

export const updateCapacityStatus = () => {
  const el = document.getElementById('capacity-status');
  if (!el) return;
  const settings = getActiveProfile()?.settings;
  if (!settings) return;
  const capacity = (settings.personnel || []).reduce((s, p) => s + (p.maxShifts || 5), 0);
  const demand = (settings.tasks || []).reduce((s, t) => s + (t.count || 1), 0) * 5;
  const diff = capacity - demand;

  const supplyEl = document.getElementById('cap-supply');
  const demandEl = document.getElementById('cap-demand');
  const noteEl = document.getElementById('cap-note');
  const fillEl = el.querySelector('.capacity-fill');
  if (supplyEl) supplyEl.textContent = capacity;
  if (demandEl) demandEl.textContent = demand;
  if (!capacity && !demand) {
    if (noteEl) noteEl.textContent = '尚未設定人員或勤務';
    el.classList.remove('short');
    return;
  }
  const pct = demand > 0 ? Math.min(100, Math.round(capacity / demand * 100)) : 100;
  if (fillEl) fillEl.style.width = pct + '%';
  if (diff >= 0) {
    el.classList.remove('short');
    if (noteEl) noteEl.textContent = `${(settings.personnel || []).length} 位人員可提供 ${capacity} 班次 · 每週需求 ${demand} · 餘 ${diff} 班`;
  } else {
    el.classList.add('short');
    if (noteEl) noteEl.textContent = `容量 ${capacity} < 需求 ${demand}，每週缺少 ${-diff} 個班次，部分勤務將排不滿`;
  }
};
