const express = require('express');
const { getIsDbConnected, getHolidaysCollection, getConfigCollection } = require('../db/connect');
const { holidaysCache, lastRefreshStatus } = require('../services/holidayService');
const { getLastFetchStatus } = require('../services/schoolCalendar');

const router = express.Router();

router.get('/api/status', async (req, res) => {
  const isDbConnected = getIsDbConnected();
  const status = {
    server: 'running',
    database: isDbConnected ? 'connected' : 'disconnected',
    // 假日 CDN／學校行事曆這兩個自動抓資料機制平常都靜默運作，失敗時也不會有
    // 任何地方顯示出來（debug log 正式環境預設不開）。這裡回報最近一次結果，
    // 讓人可以直接從 /api/status 看出這兩個機制是不是還正常。
    holidaysLastRefresh: lastRefreshStatus,
    schoolCalendarLastFetch: getLastFetchStatus(),
  };

  if (isDbConnected) {
    try {
      const holidayCount = await getHolidaysCollection().countDocuments();
      const profileCount = await getConfigCollection().countDocuments();
      status.holidaysCount = holidayCount;
      status.profilesCount = profileCount;
      status.cacheSize = holidaysCache.size;
    } catch (error) {
      status.dbError = error.message;
    }
  }

  res.json(status);
});

module.exports = router;
