const express = require('express');
const debug = require('debug');
const { getIsDbConnected } = require('../db/connect');
const { validateScheduleName, validateProfileName } = require('../validators');
const repo = require('../repositories/profileRepository');

const debugDb = debug('app:db');

const router = express.Router();

router.post('/api/schedules', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const { name, data } = req.body;

    const validation = validateScheduleName(name);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ message: '班表數據必須是非空數組' });
    }

    // 優先使用請求帶來的 profile，向下兼容未帶 profile 的舊呼叫
    let activeProfile = req.body.profile || null;
    if (activeProfile) {
      const pv = validateProfileName(activeProfile);
      if (!pv.valid) return res.status(400).json({ message: pv.error });
    } else {
      const config = await repo.getConfig();
      if (!config || !config.activeProfile) {
        return res.status(500).json({ message: '無法獲取作用中的設定檔' });
      }
      activeProfile = config.activeProfile;
    }

    await repo.saveSchedule(activeProfile, name, data);
    res.status(201).json({ message: '班表已儲存' });
  } catch (error) {
    debugDb('儲存班表失敗:', error);
    res.status(500).json({ message: '儲存班表時發生錯誤' });
  }
});

router.get('/api/schedules/:name', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const name = decodeURIComponent(req.params.name);

    const validation = validateScheduleName(name);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    const config = await repo.getConfig();
    let activeProfile = req.query.profile || null;
    if (activeProfile) {
      const pv = validateProfileName(activeProfile);
      if (!pv.valid) return res.status(400).json({ message: pv.error });
    } else {
      activeProfile = config.activeProfile;
    }

    const scheduleData = await repo.getSchedule(activeProfile, name);
    if (!scheduleData) return res.status(404).json({ message: '找不到班表' });
    res.json(scheduleData);
  } catch (error) {
    debugDb('取得班表失敗:', error);
    res.status(500).json({ message: '取得班表時發生錯誤' });
  }
});

router.delete('/api/schedules/:name', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const name = decodeURIComponent(req.params.name);

    const validation = validateScheduleName(name);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    const config = await repo.getConfig();
    let activeProfile = req.query.profile || null;
    if (activeProfile) {
      const pv = validateProfileName(activeProfile);
      if (!pv.valid) return res.status(400).json({ message: pv.error });
    } else {
      activeProfile = config.activeProfile;
    }

    await repo.deleteSchedule(activeProfile, name);
    res.json({ message: '班表已刪除' });
  } catch (error) {
    debugDb('刪除班表失敗:', error);
    res.status(500).json({ message: '刪除班表時發生錯誤' });
  }
});

module.exports = router;
