const express = require('express');
const debug = require('debug');
const { getIsDbConnected, getSchoolEventsCollection } = require('../db/connect');
const { getSchoolEvents, schoolEventsCache } = require('../services/schoolCalendar');

const debugServer = debug('app:server');

const router = express.Router();

router.get('/api/school-events', async (req, res) => {
  try {
    const result = await getSchoolEvents();
    res.json(result.data);
  } catch (e) {
    debugServer('抓取學校行事曆失敗:', e);
    res.status(500).json({ message: '無法取得學校行事曆：' + e.message });
  }
});

router.post('/api/school-events/refresh', async (req, res) => {
  try {
    if (getIsDbConnected()) {
      await getSchoolEventsCollection().deleteMany({});
    }
    schoolEventsCache.data = null;
    schoolEventsCache.fetchedAt = 0;
    const result = await getSchoolEvents();
    res.json({ message: '學校行事曆已重新整理', count: result.data.length, data: result.data });
  } catch (e) {
    debugServer('重新整理學校行事曆失敗:', e);
    res.status(500).json({ message: '重新整理失敗：' + e.message });
  }
});

module.exports = router;
