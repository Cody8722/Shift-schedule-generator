const path = require('path');
const fs = require('fs').promises;
const debug = require('debug');
const { getIsDbConnected, getHolidaysCollection } = require('../db/connect');

const debugDb = debug('app:db');
const debugServer = debug('app:server');

const holidaysCache = new Map();

// 記錄「最近一次自動更新」的結果，讓 /api/status 能回報這個機制是否還正常運作——
// 光靠 debugDb 完全不夠，因為 debug log 正式環境預設不會顯示，CDN 掛掉或格式跑掉
// 時不會有任何地方看得出來。success 用「有沒有實際抓到資料」判斷，而不是「有沒有
// 拋例外」，因為 getHolidaysForYear() 在 CDN 失敗時是回傳空 Map、不拋例外。
const lastRefreshStatus = { at: null, years: {} };

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
  const years = {};
  for (const year of [currentYear, currentYear + 1]) {
    try {
      await holidaysCollection.deleteMany({ _id: { $regex: `^${year}` }, source: 'cdn' });
      holidaysCache.delete(year);
      const holidayMap = await getHolidaysForYear(year);
      // 舊資料已經刪了，這裡如果抓到 0 筆，代表這個年份現在完全沒有假日資料
      // （CDN 那時剛好打不到），不能當成「更新成功」。
      years[year] = { success: holidayMap.size > 0, count: holidayMap.size };
      debugDb(`已自動更新 ${year} 年假日資料（${holidayMap.size} 筆）`);
    } catch (e) {
      years[year] = { success: false, count: 0, error: e.message };
      debugDb(`自動更新 ${year} 年假日資料失敗:`, e.message);
    }
  }
  lastRefreshStatus.at = Date.now();
  lastRefreshStatus.years = years;
  if (Object.values(years).some((y) => !y.success)) {
    console.warn('[holidayService] 假日自動更新有年份失敗或抓到 0 筆資料:', years);
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
    const holidayDir = path.join(__dirname, '../../../holidays');

    try {
      await fs.access(holidayDir);
    } catch {
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
  lastRefreshStatus,
  getWeekInfo,
  getHolidaysForYear,
  refreshHolidaysFromCDN,
  seedHolidays,
};
