const path = require('path');
const fs = require('fs').promises;
const debug = require('debug');
const { getIsDbConnected, getHolidaysCollection } = require('../db/connect');

const debugDb = debug('app:db');
const debugServer = debug('app:server');

const holidaysCache = new Map();

const getWeekInfo = (weekString, weekIndex) => {
  const [year, weekNum] = weekString.split('-W').map(Number);
  const simpleDate = new Date(Date.UTC(year, 0, 1 + (weekNum - 1) * 7));
  const dayOfWeek = simpleDate.getUTCDay() || 7;
  simpleDate.setUTCDate(simpleDate.getUTCDate() + 1 - dayOfWeek);

  const baseDate = new Date(simpleDate);
  baseDate.setUTCDate(baseDate.getUTCDate() + weekIndex * 7);

  const weekDates = [];
  const weekDayDates = [];
  for (let i = 0; i < 5; i++) {
    const date = new Date(baseDate);
    date.setUTCDate(date.getUTCDate() + i);
    const currentYear = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const formattedDate = `${currentYear}${month}${day}`;
    weekDates.push(formattedDate);
    weekDayDates.push(`${month}/${day}`);
  }
  return { weekDates, weekDayDates };
};

const getHolidaysForYear = async (year) => {
  const cacheKey = year;
  if (holidaysCache.has(cacheKey)) {
    debugDb(`從快取為 ${year} 年讀取假日資料。`);
    return holidaysCache.get(cacheKey);
  }

  if (!getIsDbConnected()) return new Map();

  const holidaysCollection = getHolidaysCollection();

  // 1. 先查 MongoDB
  try {
    const yearStr = String(year);
    debugDb(`從資料庫讀取 ${year} 年的假日資料...`);
    const holidays = await holidaysCollection
      .find({ _id: { $regex: `^${yearStr}` }, isHoliday: true })
      .toArray();

    if (holidays.length > 0) {
      const holidayMap = new Map();
      holidays.forEach((h) => holidayMap.set(h._id, h.name));
      holidaysCache.set(cacheKey, holidayMap);
      debugDb(`已快取 ${year} 年的 ${holidayMap.size} 個假日項目。`);
      return holidayMap;
    }
  } catch (error) {
    debugDb(`讀取 ${year} 年假日資料失敗:`, error);
    return new Map();
  }

  // 2. MongoDB 無資料 → 從 CDN 抓取
  try {
    debugDb(`MongoDB 無 ${year} 年假日資料，從 CDN 抓取...`);
    const resp = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`);
    if (resp.ok) {
      const data = await resp.json();
      const docs = data.map((h) => ({
        _id: h.date,
        name: h.description || '國定假日',
        isHoliday: h.isHoliday,
        source: 'cdn',
      }));
      await holidaysCollection.insertMany(docs, { ordered: false }).catch(() => {});
      const holidayMap = new Map();
      data.filter((h) => h.isHoliday).forEach((h) =>
        holidayMap.set(h.date, h.description || '國定假日')
      );
      holidaysCache.set(cacheKey, holidayMap);
      debugDb(`已從 CDN 取得並快取 ${year} 年假日資料（${holidayMap.size} 個假日）。`);
      return holidayMap;
    }
  } catch (e) {
    debugDb(`CDN 抓取 ${year} 年假日資料失敗:`, e.message);
  }

  return new Map();
};

const refreshHolidaysFromCDN = async () => {
  if (!getIsDbConnected()) return;
  const holidaysCollection = getHolidaysCollection();
  const currentYear = new Date().getFullYear();
  for (const year of [currentYear, currentYear + 1]) {
    try {
      await holidaysCollection.deleteMany({ _id: { $regex: `^${year}` }, source: 'cdn' });
      holidaysCache.delete(year);
      await getHolidaysForYear(year);
      debugDb(`已自動更新 ${year} 年假日資料`);
    } catch (e) {
      debugDb(`自動更新 ${year} 年假日資料失敗:`, e.message);
    }
  }
};

const seedHolidays = async () => {
  if (!getIsDbConnected()) return;
  const holidaysCollection = getHolidaysCollection();

  try {
    const count = await holidaysCollection.countDocuments();
    if (count > 0) {
      debugDb('假日資料庫已有資料，無需植入。');
      return;
    }

    debugDb('假日資料庫為空，開始從 JSON 檔案植入初始資料...');
    // 相對於 holidayService.js 的位置找到 holidays 目錄（v2/backend/src/services/ → v2/holidays/）
    const holidayDir = path.join(__dirname, '../../../../holidays');

    try {
      await fs.access(holidayDir);
    } catch (err) {
      debugServer('警告: holidays 目錄不存在，跳過假日資料植入。');
      return;
    }

    const files = await fs.readdir(holidayDir);
    const jsonFiles = files.filter((file) => file.endsWith('.json'));

    if (jsonFiles.length === 0) {
      debugServer('警告: holidays 目錄中沒有找到 JSON 檔案。');
      return;
    }

    const documents = [];

    for (const file of jsonFiles) {
      const filePath = path.join(holidayDir, file);
      debugDb(`讀取假日檔案: ${filePath}`);
      const data = await fs.readFile(filePath, 'utf-8');
      const holidayData = JSON.parse(data);

      holidayData.forEach((h) => {
        if (h.isHoliday && h.date) {
          documents.push({
            _id: h.date,
            name: h.description || h.name || '國定假日',
            isHoliday: true,
          });
        }
      });
    }

    if (documents.length > 0) {
      try {
        const result = await holidaysCollection.insertMany(documents, { ordered: false });
        debugDb(`共植入 ${result.insertedCount} 筆初始假日資料。`);
      } catch (err) {
        if (err.code === 11000) {
          const insertedCount = err.result?.nInserted || err.insertedCount || 0;
          debugDb(`部分假日資料已存在，略過重複部分。共新增 ${insertedCount} 筆資料。`);
        } else {
          throw err;
        }
      }
    } else {
      debugServer('警告: 沒有找到有效的假日資料。');
    }
  } catch (error) {
    debugServer('植入初始假日資料時發生錯誤:', error);
    debugServer('錯誤詳情:', error.stack);
  }
};

module.exports = {
  holidaysCache,
  getWeekInfo,
  getHolidaysForYear,
  refreshHolidaysFromCDN,
  seedHolidays,
};
