import { api } from '../../api/client.js';
import { debounce } from '../../utils/debounce.js';

let availableHolidays = [];
let activeHolidayDates = new Set();

export const getAvailableHolidays = () => availableHolidays;
export const getActiveHolidayDates = () => activeHolidayDates;
export const setActiveHolidayDates = (dates) => { activeHolidayDates = dates; };

export const updateHolidayButtonText = () => {
  const btn = document.getElementById('holiday-settings-btn');
  const text = document.getElementById('holiday-settings-text');
  if (!btn || !text) return;
  if (availableHolidays.length === 0) {
    text.textContent = '範圍內無國定假日';
    btn.disabled = true;
  } else {
    text.textContent = `已選 ${activeHolidayDates.size} / ${availableHolidays.length} 個假日進行排休`;
    btn.disabled = false;
  }
};

export const updateHolidaySelectionUI = async () => {
  const startWeek = document.getElementById('start-week')?.value;
  const numWeeks = document.getElementById('num-weeks')?.value;
  if (!startWeek || !numWeeks || parseInt(numWeeks, 10) < 1) {
    availableHolidays = [];
    activeHolidayDates = new Set();
    updateHolidayButtonText();
    return;
  }
  const text = document.getElementById('holiday-settings-text');
  const btn = document.getElementById('holiday-settings-btn');
  if (text) text.textContent = '正在查詢假日...';
  if (btn) btn.disabled = true;
  try {
    const holidays = await api.get(`holidays-in-range?startWeek=${startWeek}&numWeeks=${numWeeks}`);
    if (holidays) {
      availableHolidays = holidays;
      activeHolidayDates = new Set(holidays.map((h) => h.date));
    } else {
      availableHolidays = [];
      activeHolidayDates = new Set();
    }
  } catch (error) {
    console.error(error);
    availableHolidays = [];
    activeHolidayDates = new Set();
  } finally {
    updateHolidayButtonText();
  }
};

export const debouncedUpdateHolidays = debounce(updateHolidaySelectionUI, 400);
