'use strict';

const express = require('express');
const debug = require('debug')('app:pdfPayload');
const { encryptPayload, decryptPayload, isConfigured, isDecryptionPossible } = require('../services/pdfPayloadCrypto');

const router = express.Router();

// 把班表資料加密成一段 base64 字串，供前端嵌入匯出 PDF 的 metadata 欄位（人眼開啟 PDF 看不到）。
router.post('/api/pdf-payload/encrypt', (req, res) => {
  if (!isConfigured()) return res.status(503).json({ message: 'PDF 加密功能未設定' });
  try {
    const { data } = req.body;
    if (data === undefined) return res.status(400).json({ message: '缺少 data 欄位' });
    const payload = encryptPayload(data);
    res.json({ payload });
  } catch (error) {
    debug('加密失敗:', error);
    res.status(500).json({ message: '加密時發生未預期的錯誤' });
  }
});

// 把從 PDF metadata 讀出的字串解密還原成班表資料。
// 這裡刻意用 isDecryptionPossible() 而非 isConfigured()：只設定了舊制
// PDF_PAYLOAD_SECRET、還沒設定 Root 的部署，仍然要能解開改版前匯出的舊格式 PDF。
router.post('/api/pdf-payload/decrypt', (req, res) => {
  if (!isDecryptionPossible()) return res.status(503).json({ message: 'PDF 加密功能未設定' });
  try {
    const { payload } = req.body;
    if (typeof payload !== 'string' || !payload) {
      return res.status(400).json({ message: '缺少 payload 欄位' });
    }
    const data = decryptPayload(payload);
    res.json({ data });
  } catch (error) {
    debug('解密失敗（可能不是本系統匯出的 PDF，或內容已損毀）:', error);
    res.status(400).json({ message: '無法解析此 PDF，可能不是由本系統匯出，或內容已損毀' });
  }
});

module.exports = router;
