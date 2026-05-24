import {
  getActiveProfile,
  getGeneratedData,
  setGeneratedData,
  getEditingData,
  setCurrentScheduleName,
} from '../../state/appState.js';
import { api } from '../../api/client.js';
import { showToast } from '../../ui/toast.js';
import { escapeHtml } from '../../utils/escapeHtml.js';
import { renderPersonnelView } from './personnelView.js';
import { enableEditMode } from './editableSchedule.js';

const renderFillStats = (weekData) => {
  const panel = document.getElementById('fill-stats-panel');
  const grid = document.getElementById('fillrate-grid');
  if (!panel || !grid) return;

  const statsMap = {};
  for (const week of weekData) {
    for (const s of week.fillStats || []) {
      if (!statsMap[s.name]) statsMap[s.name] = { priority: s.priority, needed: 0, filled: 0 };
      statsMap[s.name].needed += s.needed;
      statsMap[s.name].filled += s.filled;
    }
  }

  const names = Object.keys(statsMap);
  if (names.length === 0) { panel.classList.add('hidden'); return; }

  panel.className = 'fillrate';

  grid.innerHTML = names.map((n) => {
    const s = statsMap[n];
    const pct = s.needed > 0 ? Math.round((s.filled / s.needed) * 100) : 100;
    const mod = pct === 100 ? '' : pct >= 50 ? ' warn' : ' danger';
    return `
    <div class="fillrate-card${mod}">
      <div><span class="name">${escapeHtml(n)}</span><span class="pri">優先 ${s.priority}</span></div>
      <div class="nums">${s.filled}/${s.needed} · ${pct}%</div>
      <div class="bar"><div style="width:${Math.min(pct, 100)}%"></div></div>
    </div>`;
  }).join('');
};

export async function generateFullSchedule(activeHolidays = []) {
  const settings = getActiveProfile().settings;
  if (!settings.personnel?.length || !settings.tasks?.length) {
    showToast('請先設定勤務與人員！', 'warning');
    return;
  }
  const startWeek = document.getElementById('start-week')?.value;
  if (!startWeek) {
    showToast('請選擇開始週！', 'warning');
    return;
  }

  const generateBtn = document.getElementById('generate-schedule');
  const generateBtnText = document.getElementById('generate-btn-text');
  const generateSpinner = document.getElementById('generate-spinner');
  const outputContainer = document.getElementById('output-container');

  generateBtn.disabled = true;
  generateBtnText.classList.add('hidden');
  generateSpinner.classList.remove('hidden');

  try {
    const numWeeks = parseInt(document.getElementById('num-weeks')?.value, 10);
    const response = await api.post('generate-schedule', {
      settings,
      startWeek,
      numWeeks,
      activeHolidays,
    });
    if (response) {
      setGeneratedData(response.data);
      setCurrentScheduleName(null);
      displaySchedule(response.html);
      renderFillStats(response.data);
    } else {
      outputContainer.classList.add('hidden');
    }
  } finally {
    generateBtn.disabled = false;
    generateBtnText.classList.remove('hidden');
    generateSpinner.classList.add('hidden');
  }
}

export function displaySchedule(scheduleHtml) {
  document.getElementById('schedule-output').innerHTML = scheduleHtml;
  document.getElementById('output-container').classList.remove('hidden');
  enableEditMode();
  const isPersonnelActive = !document.getElementById('personnel-view').classList.contains('hidden');
  if (isPersonnelActive) {
    renderPersonnelView(getEditingData() || getGeneratedData());
  }
}
