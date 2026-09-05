'use strict';

const crypto = require('crypto');
const { PDF_PAYLOAD_SECRET } = require('../config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const getKey = () => {
  if (!PDF_PAYLOAD_SECRET || !/^[0-9a-fA-F]{64}$/.test(PDF_PAYLOAD_SECRET)) return null;
  return Buffer.from(PDF_PAYLOAD_SECRET, 'hex');
};

const isConfigured = () => getKey() !== null;

// 回傳 base64 字串：iv(12 bytes) + authTag(16 bytes) + 密文，供直接嵌入 PDF metadata 欄位。
const encryptPayload = (plainObj) => {
  const key = getKey();
  if (!key) throw new Error('PDF_PAYLOAD_SECRET 未設定或格式錯誤');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(plainObj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
};

// GCM 的 authTag 驗證失敗（資料被竄改、或根本不是本系統加密的內容）會在 final() 拋出例外。
const decryptPayload = (payloadBase64) => {
  const key = getKey();
  if (!key) throw new Error('PDF_PAYLOAD_SECRET 未設定或格式錯誤');
  const buf = Buffer.from(payloadBase64, 'base64');
  if (buf.length <= IV_LENGTH + AUTH_TAG_LENGTH) throw new Error('payload 長度不足');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
};

module.exports = { encryptPayload, decryptPayload, isConfigured };
