const express = require('express');
const rateLimit = require('express-rate-limit');
const debug = require('debug');
const { validateSettings } = require('../validators');
const { getWeekInfo, getHolidaysForYear } = require('../services/holidayService');
const { generateWeeklySchedule } = require('../services/scheduleAlgorithm');
const { generateScheduleHtml } = require('../services/scheduleRenderer');

const debugSchedule = debug('app:schedule');

const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: '產生班表次數過多，請於 15 分鐘後再試。',
});

const router = express.Router();

router.post('/api/generate-schedule', generateLimiter, async (req, res) => {
  try {
    const { settings, startWeek, numWeeks, activeHolidays } = req.body;

    const validation = validateSettings(settings);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    if (!Number.isInteger(numWeeks) || numWeeks < 1 || numWeeks > 52) {
      return res.status(400).json({ message: 'numWeeks 必須是 1-52 的整數' });
    }

    if (typeof startWeek !== 'string' || !/^\d{4}-W\d{1,2}$/.test(startWeek)) {
      return res.status(400).json({ message: 'startWeek 格式必須是 YYYY-Wnn' });
    }

    const resolvedHolidays = activeHolidays === undefined ? [] : activeHolidays;
    if (!Array.isArray(resolvedHolidays) || !resolvedHolidays.every((d) => typeof d === 'string')) {
      return res.status(400).json({ message: 'activeHolidays 必須是字串陣列' });
    }

    const fullScheduleData = [];
    const colors = [
      { header: '#0284c7', row: '#f0f9ff' },
      { header: '#15803d', row: '#f0fdf4' },
      { header: '#be185d', row: '#fdf2f8' },
      { header: '#86198f', row: '#faf5ff' },
    ];
    const cumulativeShifts = new Map();

    for (let i = 0; i < numWeeks; i++) {
      const { weekDates, weekDayDates } = getWeekInfo(startWeek, i);
      const years = [...new Set(weekDates.map((d) => parseInt(d.substring(0, 4))))];
      const allHolidayMaps = await Promise.all(years.map((year) => getHolidaysForYear(year)));
      const originalHolidaysMap = new Map();
      allHolidayMaps.forEach((holidayMap) => {
        for (const [date, name] of holidayMap.entries()) {
          originalHolidaysMap.set(date, name);
        }
      });
      const scheduleDays = weekDates.map((date) => ({
        date,
        shouldSchedule: !resolvedHolidays.includes(date),
        description: resolvedHolidays.includes(date)
          ? originalHolidaysMap.get(date) || '假日'
          : '',
      }));
      const { weeklySchedule, fillStats, weekShiftCounts } = generateWeeklySchedule(
        settings,
        scheduleDays,
        cumulativeShifts
      );
      for (const [name, count] of weekShiftCounts) {
        cumulativeShifts.set(name, (cumulativeShifts.get(name) || 0) + count);
      }
      fullScheduleData.push({
        schedule: weeklySchedule,
        fillStats,
        tasks: settings.tasks,
        dateRange: `${weekDayDates[0]} - ${weekDayDates[4]}`,
        weekDayDates,
        scheduleDays,
        color: colors[i % colors.length],
      });
    }

    const scheduleHtml = generateScheduleHtml(fullScheduleData);
    res.json({ data: fullScheduleData, html: scheduleHtml });
  } catch (error) {
    debugSchedule('產生班表時發生錯誤:', error);
    res.status(500).json({ message: '產生班表時發生未預期的錯誤' });
  }
});

router.post('/api/render-schedule', (req, res) => {
  try {
    const fullScheduleData = req.body;
    if (!Array.isArray(fullScheduleData)) {
      return res.status(400).json({ message: '無效的班表資料格式' });
    }
    const scheduleHtml = generateScheduleHtml(fullScheduleData);
    res.json({ html: scheduleHtml });
  } catch (error) {
    debugSchedule('渲染已儲存班表時發生錯誤:', error);
    res.status(500).json({ message: '渲染班表時發生未預期的錯誤' });
  }
});

module.exports = router;
