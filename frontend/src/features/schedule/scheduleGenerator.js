import { api } from '../../api/client.js';
import { showToast } from '../../ui/toast.js';
import { escapeHtml } from '../../utils/escapeHtml.js';
import {
  getActiveProfile,
  getGeneratedData,
  setGeneratedData,
  getEditingData,
  setCurrentScheduleName,
} from '../../state/appState.js';
import { getActiveHolidayDates } from '../holidays/holidaySelector.js';
import { enableEditMode } from './editor.js';
import { renderPersonnelView } from './personnelView.js';

export const renderFillStats = (weekData) => {
  const panel = document.getElementById('fill-stats-panel');
  if (!panel) return;
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
  const allOk = names.every((n) => statsMap[n].filled === statsMap[n].needed);
  if (allOk) {
    panel.className = 'mt-4 text-sm p-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    panel.textContent = '所有勤務已排滿';
    return;
  }
  const rows = names.map((n) => {
    const s = statsMap[n];
    const pct = s.needed > 0 ? Math.round((s.filled / s.needed) * 100) : 100;
    const color =
      pct === 100 ? 'text-green-700 dark:text-green-300' :
      pct >= 50   ? 'text-yellow-700 dark:text-yellow-300' :
                    'text-red-700 dark:text-red-300';
    return `<tr class="${color}"><td class="pr-3 py-0.5">${escapeHtml(n)}</td><td class="pr-3">優先 ${s.priority}</td><td class="pr-3">${s.filled} / ${s.needed}</td><td>${pct}%</td></tr>`;
  }).join('');
  panel.className = 'mt-4';
  panel.innerHTML = `<p class="text-sm font-semibold mb-1">勤務填補率</p><table class="text-sm"><thead><tr class="text-muted"><th class="pr-3 text-left font-normal">勤務</th><th class="pr-3 text-left font-normal">優先級</th><th class="pr-3 text-left font-normal">填補/需求</th><th class="text-left font-normal">填補率</th></tr></thead><tbody>${rows}</tbody></table>`;
};

export const displaySchedule = (scheduleHtml) => {
  const scheduleOutput = document.getElementById('schedule-output');
  const outputContainer = document.getElementById('output-container');
  if (scheduleOutput) scheduleOutput.innerHTML = scheduleHtml;
  if (outputContainer) outputContainer.classList.remove('hidden');
  enableEditMode();
  const isPersonnelActive = !document.getElementById('personnel-view')?.classList.contains('hidden');
  if (isPersonnelActive) {
    renderPersonnelView(getEditingData() || getGeneratedData());
  }
};

export const generateFullSchedule = async () => {
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
  const activeHolidays = Array.from(getActiveHolidayDates());

  const generateBtn = document.getElementById('generate-schedule');
  const generateBtnText = document.getElementById('generate-btn-text');
  const generateSpinner = document.getElementById('generate-spinner');
  const outputContainer = document.getElementById('output-container');

  if (generateBtn) generateBtn.disabled = true;
  if (generateBtnText) generateBtnText.classList.add('hidden');
  if (generateSpinner) generateSpinner.classList.remove('hidden');

  try {
    const response = await api.post('generate-schedule', {
      settings,
      startWeek,
      numWeeks: parseInt(document.getElementById('num-weeks')?.value, 10),
      activeHolidays,
    });
    if (response) {
      setGeneratedData(response.data);
      setCurrentScheduleName(null);
      displaySchedule(response.html);
      renderFillStats(response.data);
    } else {
      if (outputContainer) outputContainer.classList.add('hidden');
    }
  } finally {
    if (generateBtn) generateBtn.disabled = false;
    if (generateBtnText) generateBtnText.classList.remove('hidden');
    if (generateSpinner) generateSpinner.classList.add('hidden');
  }
};
