const express = require('express');
const debug = require('debug');
const { getIsDbConnected, getHolidaysCollection } = require('../db/connect');
const {
  holidaysCache,
  getWeekInfo,
  getHolidaysForYear,
  seedHolidays,
} = require('../services/holidayService');

const debugDb = debug('app:db');
const debugSchedule = debug('app:schedule');

const router = express.Router();

router.get('/api/holidays/:year', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const { year } = req.params;
    const holidays = await getHolidaysCollection()
      .find({ _id: { $regex: `^${year}` }, isHoliday: true })
      .toArray();
    res.json(holidays.map((h) => ({ date: h._id, name: h.name })));
  } catch (error) {
    debugDb('讀取年度假日失敗:', error);
    res.status(500).json({ message: '讀取年度假日失敗' });
  }
});

router.post('/api/holidays/reseed', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    debugDb('手動觸發假日資料重新植入...');
    const deleteResult = await getHolidaysCollection().deleteMany({});
    debugDb(`已刪除 ${deleteResult.deletedCount} 筆舊假日資料。`);
    holidaysCache.clear();
    await seedHolidays();
    const count = await getHolidaysCollection().countDocuments();
    res.json({ message: '假日資料重新植入完成', count });
  } catch (error) {
    debugDb('重新植入假日資料失敗:', error);
    res.status(500).json({ message: '重新植入假日資料失敗', error: error.message });
  }
});

router.put('/api/holidays', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const { date, name, isHoliday } = req.body;
    if (!date) return res.status(400).json({ message: '日期為必填欄位' });

    const year = parseInt(date.substring(0, 4));
    holidaysCache.delete(year);

    const filter = { _id: date };

    if (isHoliday) {
      const update = { $set: { name, isHoliday: true } };
      await getHolidaysCollection().updateOne(filter, update, { upsert: true });
    } else {
      await getHolidaysCollection().deleteOne(filter);
    }
    res.json({ message: '假日設定已更新' });
  } catch (error) {
    debugDb('更新假日設定失敗:', error);
    res.status(500).json({ message: '更新假日設定失敗' });
  }
});

router.get('/api/holidays-in-range', async (req, res) => {
  const { startWeek, numWeeks } = req.query;
  if (!startWeek || !numWeeks) {
    return res.status(400).json({ message: '缺少 startWeek 或 numWeeks 參數' });
  }

  // 禁用快取，確保每次都取得最新資料
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    const allDatesInRange = [];
    const numWeeksInt = parseInt(numWeeks, 10);
    for (let i = 0; i < numWeeksInt; i++) {
      const { weekDates } = getWeekInfo(startWeek, i);
      allDatesInRange.push(...weekDates);
    }
    const years = [...new Set(allDatesInRange.map((d) => parseInt(d.substring(0, 4))))];
    const allHolidayMaps = await Promise.all(years.map((year) => getHolidaysForYear(year)));

    const combinedHolidays = new Map();
    allHolidayMaps.forEach((holidayMap) => {
      for (const [date, name] of holidayMap.entries()) {
        combinedHolidays.set(date, name);
      }
    });

    const holidaysInRange = allDatesInRange
      .filter((date) => combinedHolidays.has(date))
      .map((date) => ({ date, name: combinedHolidays.get(date) }));
    res.json(holidaysInRange);
  } catch (error) {
    debugSchedule('查詢區間假日失敗:', error);
    res.status(500).json({ message: '查詢假日資料時發生錯誤' });
  }
});

module.exports = router;
