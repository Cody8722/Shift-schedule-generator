const express = require('express');
const debug = require('debug');
const { getSchoolEvents } = require('../services/schoolCalendar');

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

module.exports = router;
