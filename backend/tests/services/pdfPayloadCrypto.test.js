'use strict';

process.env.NODE_ENV = 'test';

const crypto = require('crypto');

describe('pdfPayloadCrypto', () => {
  const ROOT = 'a'.repeat(64);
  const LEGACY_SECRET = 'b'.repeat(64);
  const ENV_KEYS = ['PDF_PAYLOAD_SECRET', 'PDF_PAYLOAD_ROOT_SECRET', 'PDF_PAYLOAD_KEK_CURRENT'];

  // env 為 undefined 的欄位會被 delete，其餘會被設定——每次都重新 require 模組，
  // 確保 config.js 模組層讀到的是這次測試指定的值，不是上一個測試殘留的。
  const loadModule = (env = {}) => {
    jest.resetModules();
    for (const key of ENV_KEYS) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    return require('../../src/services/pdfPayloadCrypto');
  };

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  // 模擬改版前的舊格式 payload：沒有版號欄位，直接用 PDF_PAYLOAD_SECRET 當 KEK
  // 做 AES-256-GCM 加密，複製當初 v0 機制的加密邏輯，不透過現在的 encryptPayload()
  // （它現在只會產生新格式）。
  const buildLegacyV0Payload = (plainObj, hexKey) => {
    const key = Buffer.from(hexKey, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(plainObj), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  };

  describe('isConfigured（加密新資料是否可用）', () => {
    it('什麼都沒設定時回傳 false', () => {
      expect(loadModule({}).isConfigured()).toBe(false);
    });

    it('只設定舊制 PDF_PAYLOAD_SECRET（沒有 Root）時回傳 false', () => {
      expect(loadModule({ PDF_PAYLOAD_SECRET: LEGACY_SECRET }).isConfigured()).toBe(false);
    });

    it('有 Root 但版本號格式錯誤時回傳 false', () => {
      const mod = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'not-a-version' });
      expect(mod.isConfigured()).toBe(false);
    });

    it('版本號為 v0 時視為無效（v0 保留給舊制相容用）', () => {
      const mod = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v0' });
      expect(mod.isConfigured()).toBe(false);
    });

    it('Root 格式錯誤時回傳 false', () => {
      const mod = loadModule({ PDF_PAYLOAD_ROOT_SECRET: 'nope', PDF_PAYLOAD_KEK_CURRENT: 'v1' });
      expect(mod.isConfigured()).toBe(false);
    });

    it('Root 與版本號都正確時回傳 true', () => {
      const mod = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v1' });
      expect(mod.isConfigured()).toBe(true);
    });
  });

  describe('isDecryptionPossible（解密是否有任何可能）', () => {
    it('什麼都沒設定時回傳 false', () => {
      expect(loadModule({}).isDecryptionPossible()).toBe(false);
    });

    it('只設定舊制 PDF_PAYLOAD_SECRET 時回傳 true（仍可解 v0 舊格式）', () => {
      expect(loadModule({ PDF_PAYLOAD_SECRET: LEGACY_SECRET }).isDecryptionPossible()).toBe(true);
    });

    it('只設定 Root（沒設版本號）時回傳 true（Root 本身就能算出任何版本的 KEK）', () => {
      expect(loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT }).isDecryptionPossible()).toBe(true);
    });
  });

  describe('新格式加解密（Root + HKDF 版本衍生）', () => {
    it('encryptPayload/decryptPayload 可以正確往返還原資料', () => {
      const mod = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v1' });
      const original = { weeks: [{ tasks: ['素描教室'], schedule: [['張三', '李四']] }] };
      const encrypted = mod.encryptPayload(original);
      expect(mod.decryptPayload(encrypted)).toEqual(original);
    });

    it('加密結果開頭帶有目前版本號前綴', () => {
      const mod = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v3' });
      expect(mod.encryptPayload({ x: 1 })).toMatch(/^v3:/);
    });

    it('相同資料每次加密結果不同（iv 隨機產生）', () => {
      const mod = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v1' });
      expect(mod.encryptPayload({ x: 1 })).not.toBe(mod.encryptPayload({ x: 1 }));
    });

    it('換了目前版本號之後，用舊版本號加密過的 payload 仍然解得開（Root 沒變）', () => {
      const modV1 = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v1' });
      const encryptedUnderV1 = modV1.encryptPayload({ x: 1 });

      const modV2 = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v2' });
      expect(modV2.decryptPayload(encryptedUnderV1)).toEqual({ x: 1 });
    });

    it('payload 宣告的版本號跟實際加密用的版本號對不上時解密失敗', () => {
      const mod = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v1' });
      const encrypted = mod.encryptPayload({ x: 1 });
      const wrongVersionPayload = encrypted.replace(/^v1:/, 'v2:');
      expect(() => mod.decryptPayload(wrongVersionPayload)).toThrow();
    });

    it('Root 不同的話，同版本號也算不出一樣的 KEK（換 Root 等於所有版本一起失效）', () => {
      const modOldRoot = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v1' });
      const encrypted = modOldRoot.encryptPayload({ x: 1 });

      const differentRoot = 'c'.repeat(64);
      const modNewRoot = loadModule({ PDF_PAYLOAD_ROOT_SECRET: differentRoot, PDF_PAYLOAD_KEK_CURRENT: 'v1' });
      expect(() => modNewRoot.decryptPayload(encrypted)).toThrow();
    });

    it('decryptPayload 遇到被竄改的內容會拋出例外', () => {
      const mod = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v1' });
      const encrypted = mod.encryptPayload({ x: 1 });
      const tampered = encrypted.slice(0, -4) + (encrypted.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
      expect(() => mod.decryptPayload(tampered)).toThrow();
    });

    it('encryptPayload 在 Root/版本號未設定時拋出例外', () => {
      const mod = loadModule({});
      expect(() => mod.encryptPayload({ x: 1 })).toThrow();
    });
  });

  describe('v0 舊格式相容（改版前用 PDF_PAYLOAD_SECRET 直接加密的 PDF）', () => {
    it('沒有版號前綴的舊格式，只設定 PDF_PAYLOAD_SECRET（沒有 Root）也能正確解密', () => {
      const mod = loadModule({ PDF_PAYLOAD_SECRET: LEGACY_SECRET });
      const original = { legacy: true };
      const legacyPayload = buildLegacyV0Payload(original, LEGACY_SECRET);
      expect(mod.decryptPayload(legacyPayload)).toEqual(original);
    });

    it('改版後即使已設定 Root + 新版本號，舊格式 payload 仍然走 v0 邏輯正確解密', () => {
      const mod = loadModule({
        PDF_PAYLOAD_SECRET: LEGACY_SECRET,
        PDF_PAYLOAD_ROOT_SECRET: ROOT,
        PDF_PAYLOAD_KEK_CURRENT: 'v1',
      });
      const original = { legacy: true };
      const legacyPayload = buildLegacyV0Payload(original, LEGACY_SECRET);
      expect(mod.decryptPayload(legacyPayload)).toEqual(original);
    });

    it('沒有設定 PDF_PAYLOAD_SECRET 時，舊格式 payload 解密失敗', () => {
      const mod = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v1' });
      const legacyPayload = buildLegacyV0Payload({ legacy: true }, LEGACY_SECRET);
      expect(() => mod.decryptPayload(legacyPayload)).toThrow();
    });
  });

  describe('decryptPayload 的一般錯誤情況', () => {
    it('什麼金鑰都沒設定時拋出例外', () => {
      const mod = loadModule({});
      expect(() => mod.decryptPayload('v1:anything')).toThrow();
    });

    it('格式不符的字串（非本系統加密）會拋出例外', () => {
      const mod = loadModule({ PDF_PAYLOAD_ROOT_SECRET: ROOT, PDF_PAYLOAD_KEK_CURRENT: 'v1' });
      expect(() => mod.decryptPayload('v1:' + Buffer.from('random unrelated text').toString('base64'))).toThrow();
    });
  });
});
