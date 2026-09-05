'use strict';

const express = require('express');
const debug = require('debug')('app:shares');
const { getIsDbConnected } = require('../db/connect');
const { validateProfileName, validateScheduleName } = require('../validators');
const shareRepo = require('../repositories/shareRepository');
const profileRepo = require('../repositories/profileRepository');
const { generateScheduleHtml } = require('../services/scheduleRenderer');

const router = express.Router();

// 保留完整週次/任務結構，只把「不是這個人」的格子清空——這樣可以直接沿用既有的
// generateScheduleHtml 渲染邏輯，不用另外寫一份簡化版渲染器。
const filterScheduleForPerson = (fullScheduleData, personName) =>
  fullScheduleData.map((week) => ({
    ...week,
    schedule: week.schedule.map((day) => day.map((cell) => cell.filter((name) => name === personName))),
  }));

// 建立一個免登入的分享連結（token），對應到某個已儲存的班表，選填只給單一人員看。
router.post('/api/schedule-shares', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const { profile, scheduleName, personFilter, expiresInDays } = req.body;

    const profileValidation = validateProfileName(profile);
    if (!profileValidation.valid) return res.status(400).json({ message: profileValidation.error });

    const nameValidation = validateScheduleName(scheduleName);
    if (!nameValidation.valid) return res.status(400).json({ message: nameValidation.error });

    if (personFilter !== undefined && personFilter !== null && typeof personFilter !== 'string') {
      return res.status(400).json({ message: 'personFilter 必須是字串' });
    }

    // expiresInDays 為 null/undefined 代表永久有效；有帶值時限制在合理範圍（1-365 天）。
    if (
      expiresInDays !== undefined &&
      expiresInDays !== null &&
      (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365)
    ) {
      return res.status(400).json({ message: 'expiresInDays 必須是 1-365 之間的整數' });
    }

    const scheduleData = await profileRepo.getSchedule(profile, scheduleName);
    if (!scheduleData) return res.status(404).json({ message: '找不到指定的班表' });

    const token = await shareRepo.createShare(profile, scheduleName, personFilter || null, expiresInDays || null);
    res.status(201).json({ token });
  } catch (error) {
    debug('建立分享連結失敗:', error);
    res.status(500).json({ message: '建立分享連結時發生錯誤' });
  }
});

// 公開端點，刻意不需要登入——分享連結的重點就是讓拿到連結的人直接看，不用進到後台。
router.get('/api/schedule-shares/:token', async (req, res) => {
  if (!getIsDbConnected()) return res.status(503).json({ message: '資料庫未連線' });
  try {
    const { token } = req.params;
    const share = await shareRepo.getShare(token);
    if (!share) return res.status(404).json({ message: '此分享連結不存在或已失效' });

    // MongoDB 的 TTL 背景清除任務約每 60 秒才跑一次，不是精準即時刪除，
    // 這裡自己再檢查一次 expiresAt，確保過期的瞬間就正確擋下，不用等背景任務清掉文件。
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return res.status(404).json({ message: '此分享連結已過期' });
    }

    const scheduleData = await profileRepo.getSchedule(share.profile, share.scheduleName);
    if (!scheduleData) return res.status(404).json({ message: '此分享連結對應的班表已被刪除' });

    // 有 personFilter 時在伺服器端就把其他人的資料過濾掉，不能只靠前端不顯示——
    // 否則瀏覽器開發者工具的網路分頁還是看得到完整班表 JSON，等於白做安全性。
    const filteredData = share.personFilter
      ? filterScheduleForPerson(scheduleData, share.personFilter)
      : scheduleData;

    const html = generateScheduleHtml(filteredData);
    res.json({ html, scheduleName: share.scheduleName, personFilter: share.personFilter });
  } catch (error) {
    debug('讀取分享連結失敗:', error);
    res.status(500).json({ message: '讀取分享連結時發生錯誤' });
  }
});

module.exports = router;
