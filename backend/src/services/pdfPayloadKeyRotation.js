const debug = require('debug')('app:pdfPayloadKeyRotation');
const { getIsDbConnected } = require('../db/connect');
const { PDF_PAYLOAD_KEK_CURRENT } = require('../config');
const repo = require('../repositories/pdfPayloadKeyStateRepository');

const ROTATION_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天自動輪替一次
const DEFAULT_VERSION = 'v1';
const VERSION_REGEX = /^v([1-9]\d*)$/;

// 目前版本號的記憶體快取，供 pdfPayloadCrypto.js 同步讀取（加密流程本身不碰 DB，
// 只有這個服務自己的初始化/定期輪替邏輯需要非同步存取 Mongo）。
// 跟 holidayService.js 的 holidaysCache 是同一種「記憶體快取 + 定期跟 DB 同步」模式。
let cachedState = null; // { currentVersion, rotatedAt } | null（尚未初始化或無 DB）

const parseVersionNumber = (version) => {
  const match = VERSION_REGEX.exec(version);
  return match ? parseInt(match[1], 10) : null;
};

const nextVersion = (version) => {
  const n = parseVersionNumber(version);
  return n === null ? DEFAULT_VERSION : `v${n + 1}`;
};

const getCurrentVersion = () => cachedState?.currentVersion || null;

// 供 /api/status 回報用：目前版本、上次輪替時間、下次預計輪替時間。
const getRotationStatus = () => {
  if (!cachedState) return { currentVersion: null, rotatedAt: null, nextRotationDue: null };
  return {
    currentVersion: cachedState.currentVersion,
    rotatedAt: cachedState.rotatedAt,
    nextRotationDue: new Date(new Date(cachedState.rotatedAt).getTime() + ROTATION_INTERVAL_MS).toISOString(),
  };
};

// 伺服器啟動時呼叫：DB 裡沒有狀態文件（第一次啟動這個機制）就用環境變數
// PDF_PAYLOAD_KEK_CURRENT 當種子值（沒設定就預設 v1）建立一筆，之後 DB 就是
// 唯一的真相來源，這個環境變數不會再被讀取。
const initKeyState = async () => {
  if (!getIsDbConnected()) return;
  try {
    const existing = await repo.getState();
    if (existing) {
      cachedState = { currentVersion: existing.currentVersion, rotatedAt: existing.rotatedAt };
      debug('已從資料庫載入目前金鑰版本: %s', cachedState.currentVersion);
      return;
    }
    const seedVersion = VERSION_REGEX.test(PDF_PAYLOAD_KEK_CURRENT) ? PDF_PAYLOAD_KEK_CURRENT : DEFAULT_VERSION;
    const rotatedAt = new Date().toISOString();
    await repo.setState(seedVersion, rotatedAt);
    cachedState = { currentVersion: seedVersion, rotatedAt };
    debug('資料庫尚無金鑰版本狀態，已建立初始版本: %s', seedVersion);
  } catch (error) {
    console.error('[pdfPayloadKeyRotation] 初始化金鑰版本狀態失敗:', error);
  }
};

// 每次呼叫都檢查是否已達輪替間隔（預設每 30 天），到了就自動升版並寫回資料庫。
// Root 本身完全不受影響——只是換一個 info 參數，HKDF 現場重算，不需要人工介入。
const rotateIfDue = async () => {
  if (!getIsDbConnected() || !cachedState) return;
  const elapsed = Date.now() - new Date(cachedState.rotatedAt).getTime();
  if (elapsed < ROTATION_INTERVAL_MS) return;

  const newVersion = nextVersion(cachedState.currentVersion);
  const rotatedAt = new Date().toISOString();
  try {
    await repo.setState(newVersion, rotatedAt);
    const oldVersion = cachedState.currentVersion;
    cachedState = { currentVersion: newVersion, rotatedAt };
    debug('金鑰版本已自動輪替: %s → %s', oldVersion, newVersion);
  } catch (error) {
    console.error('[pdfPayloadKeyRotation] 自動輪替金鑰版本失敗（沿用目前版本繼續運作）:', error);
  }
};

module.exports = { initKeyState, rotateIfDue, getCurrentVersion, getRotationStatus };
