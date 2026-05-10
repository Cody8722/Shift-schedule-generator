const express = require('express');
const debug = require('debug');
const { getIsDbConnected } = require('../db/connect');
const { validateProfileName, validateSettings } = require('../validators');
const repo = require('../repositories/profileRepository');

const debugDb = debug('app:db');

const router = express.Router();

router.get('/api/profiles', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const config = await repo.getConfig();
    res.json(config || {});
  } catch (error) {
    debugDb('讀取設定檔失敗:', error);
    res.status(500).json({ message: '讀取設定檔時發生錯誤' });
  }
});

router.put('/api/profiles/active', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const { name } = req.body;
    await repo.setActiveProfile(name);
    res.json({ message: '作用中的設定檔已更新' });
  } catch (error) {
    debugDb('更新作用中設定檔失敗:', error);
    res.status(500).json({ message: '更新作用中設定檔時發生錯誤' });
  }
});

router.post('/api/profiles', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const { name } = req.body;
    const validation = validateProfileName(name);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }
    await repo.createProfile(name);
    res.status(201).json({ message: '設定檔已新增' });
  } catch (error) {
    debugDb('新增設定檔失敗:', error);
    res.status(500).json({ message: error.message || '新增設定檔時發生錯誤' });
  }
});

router.put('/api/profiles/:name', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const decodedName = decodeURIComponent(req.params.name);
    const { settings } = req.body;

    const nameValidation = validateProfileName(decodedName);
    if (!nameValidation.valid) {
      return res.status(400).json({ message: nameValidation.error });
    }

    const settingsValidation = validateSettings(settings);
    if (!settingsValidation.valid) {
      return res.status(400).json({ message: settingsValidation.error });
    }

    await repo.updateProfileSettings(decodedName, settings);
    res.json({ message: `設定檔 ${decodedName} 已更新` });
  } catch (error) {
    debugDb('更新設定檔失敗:', error);
    if (error.status === 404) {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: '更新設定檔時發生錯誤' });
  }
});

router.put('/api/profiles/:name/rename', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const oldName = decodeURIComponent(req.params.name);
    const { newName } = req.body;

    const oldNameValidation = validateProfileName(oldName);
    if (!oldNameValidation.valid) {
      return res.status(400).json({ message: '舊名稱無效: ' + oldNameValidation.error });
    }
    const newNameValidation = validateProfileName(newName);
    if (!newNameValidation.valid) {
      return res.status(400).json({ message: '新名稱無效: ' + newNameValidation.error });
    }

    await repo.renameProfile(oldName, newName);
    debugDb(`設定檔已重新命名: "${oldName}" → "${newName}"`);
    res.json({ message: '設定檔已重新命名' });
  } catch (error) {
    debugDb('重新命名設定檔失敗:', error);
    res.status(500).json({ message: error.message || '重新命名設定檔時發生錯誤' });
  }
});

router.delete('/api/profiles/:name', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const nameToDelete = decodeURIComponent(req.params.name);

    const validation = validateProfileName(nameToDelete);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    await repo.deleteProfile(nameToDelete);
    res.json({ message: '設定檔已刪除' });
  } catch (error) {
    debugDb('刪除設定檔失敗:', error);
    if (error.status === 400) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: '刪除設定檔時發生錯誤' });
  }
});

module.exports = router;
