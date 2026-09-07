'use strict';

const crypto = require('crypto');
const { PDF_PAYLOAD_SECRET, PDF_PAYLOAD_ROOT_SECRET, PDF_PAYLOAD_KEK_CURRENT } = require('../config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
// HKDF 的 salt 不是秘密，固定值即可——IKM（Root Secret）本身已經是高熵隨機值，
// 不是需要防彩虹表的低熵密碼，salt 在這裡的作用只是網域區隔，不需要保密或隨機化。
const HKDF_SALT = Buffer.from('schedule-pdf-payload-hkdf-salt', 'utf8');
const HEX_KEY_REGEX = /^[0-9a-fA-F]{64}$/;
const VERSION_REGEX = /^v[1-9]\d*$/;

const parseHexKey = (value) => (value && HEX_KEY_REGEX.test(value) ? Buffer.from(value, 'hex') : null);

// v0（改版前）的相容金鑰：PDF_PAYLOAD_SECRET 的值直接當 KEK 用，不經過 HKDF、
// 也不再用來加密任何新資料——只為了讓改版前就已經匯出、流通在外的舊 PDF 還能解密。
const getV0Key = () => parseHexKey(PDF_PAYLOAD_SECRET);

const getRootSecret = () => parseHexKey(PDF_PAYLOAD_ROOT_SECRET);

const isVersionFormatValid = (version) => typeof version === 'string' && VERSION_REGEX.test(version);

// 每一版實際用來加解密的金鑰用 HKDF 從 Root 現場算出來，不另外存成環境變數。
// HKDF 是單向函式：就算某一版算出來的 KEK 外洩（例如不小心寫進 log），也推不回
// Root、推不出其他版本的 KEK，換一個新版本號就能直接隔離，不影響 Root 或其他版本。
const deriveKekForVersion = (version) => {
  if (!isVersionFormatValid(version)) return null;
  const root = getRootSecret();
  if (!root) return null;
  const info = Buffer.from(`schedule-pdf-payload:${version}`, 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', root, HKDF_SALT, info, KEY_LENGTH));
};

const getCurrentVersion = () => (isVersionFormatValid(PDF_PAYLOAD_KEK_CURRENT) ? PDF_PAYLOAD_KEK_CURRENT : null);

// 加密（產生新資料）是否可用：取決於 Root + 目前版本號是否都正確設定。
// 舊制的 PDF_PAYLOAD_SECRET 只影響「能不能解開 v0 舊格式」，不影響這裡。
const isConfigured = () => {
  const version = getCurrentVersion();
  return version !== null && deriveKekForVersion(version) !== null;
};

// 解密是否有任何可能——只要 Root（可以算出任何版本的 KEK）或舊制金鑰（v0）任一有設定即可，
// 實際某個 payload 到底解不解得開，還是要看它宣告的版本對不對得上。
const isDecryptionPossible = () => getRootSecret() !== null || getV0Key() !== null;

// payload 格式：{版本號}:{base64(iv+authTag+密文)}。加密永遠用「目前版本」，
// 不會用舊版本（含 v0）加密新資料。
const encryptPayload = (plainObj) => {
  const version = getCurrentVersion();
  const key = deriveKekForVersion(version);
  if (!version || !key) {
    throw new Error('PDF_PAYLOAD_ROOT_SECRET / PDF_PAYLOAD_KEK_CURRENT 未設定或格式錯誤');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(plainObj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const body = Buffer.concat([iv, authTag, encrypted]).toString('base64');
  return `${version}:${body}`;
};

const decryptWithKey = (key, iv, authTag, encrypted) => {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
};

// GCM 的 authTag 驗證失敗（金鑰不對、資料被竄改、或根本不是本系統加密的內容）
// 會在 final() 拋出例外，統一往外拋讓呼叫端當成「無法解密」處理。
//
// 沒有版號欄位（不含冒號）的舊格式，視同隱含 v0，直接用 PDF_PAYLOAD_SECRET 當 KEK
// 解密（不經 HKDF）——確保改版前就已經匯出、流通在外的 PDF 不用重新匯出照樣能匯入。
// 有版號欄位的，用 HKDF(Root, info=該版本號) 現場算出對應 KEK 解密，不管目前
// PDF_PAYLOAD_KEK_CURRENT 是哪一版，只要 Root 沒換過，任何版本都算得出來。
const decryptPayload = (payload) => {
  if (typeof payload !== 'string' || !payload) throw new Error('payload 格式錯誤');

  const separatorIndex = payload.indexOf(':');
  const version = separatorIndex === -1 ? 'v0' : payload.slice(0, separatorIndex);
  const body = separatorIndex === -1 ? payload : payload.slice(separatorIndex + 1);

  const key = version === 'v0' ? getV0Key() : deriveKekForVersion(version);
  if (!key) throw new Error(`找不到版本 ${version} 對應的金鑰`);

  const buf = Buffer.from(body, 'base64');
  if (buf.length <= IV_LENGTH + AUTH_TAG_LENGTH) throw new Error('payload 長度不足');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  return decryptWithKey(key, iv, authTag, encrypted);
};

module.exports = { encryptPayload, decryptPayload, isConfigured, isDecryptionPossible };
