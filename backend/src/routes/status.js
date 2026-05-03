const express = require('express');
const { getIsDbConnected, getHolidaysCollection, getConfigCollection } = require('../db/connect');
const { holidaysCache } = require('../services/holidayService');

const router = express.Router();

router.get('/api/status', async (req, res) => {
  const isDbConnected = getIsDbConnected();
  const status = {
    server: 'running',
    database: isDbConnected ? 'connected' : 'disconnected',
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
