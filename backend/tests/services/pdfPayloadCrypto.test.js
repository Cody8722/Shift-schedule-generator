'use strict';

process.env.NODE_ENV = 'test';

describe('pdfPayloadCrypto', () => {
  const VALID_SECRET = 'a'.repeat(64);

  const loadModule = (secret) => {
    jest.resetModules();
    if (secret === undefined) {
      delete process.env.PDF_PAYLOAD_SECRET;
    } else {
      process.env.PDF_PAYLOAD_SECRET = secret;
    }
    return require('../../src/services/pdfPayloadCrypto');
  };

  afterEach(() => {
    delete process.env.PDF_PAYLOAD_SECRET;
  });

  it('isConfigured() 在密鑰未設定時回傳 false', () => {
    const { isConfigured } = loadModule(undefined);
    expect(isConfigured()).toBe(false);
  });

  it('isConfigured() 在密鑰格式錯誤時回傳 false', () => {
    const { isConfigured } = loadModule('not-a-valid-hex-key');
    expect(isConfigured()).toBe(false);
  });

  it('isConfigured() 在密鑰格式正確時回傳 true', () => {
    const { isConfigured } = loadModule(VALID_SECRET);
    expect(isConfigured()).toBe(true);
  });

  it('encryptPayload/decryptPayload 可以正確往返還原資料', () => {
    const { encryptPayload, decryptPayload } = loadModule(VALID_SECRET);
    const original = { weeks: [{ tasks: ['素描教室'], schedule: [['張三', '李四']] }] };
    const encrypted = encryptPayload(original);
    expect(typeof encrypted).toBe('string');
    expect(decryptPayload(encrypted)).toEqual(original);
  });

  it('相同資料每次加密結果不同（iv 隨機產生）', () => {
    const { encryptPayload } = loadModule(VALID_SECRET);
    expect(encryptPayload({ x: 1 })).not.toBe(encryptPayload({ x: 1 }));
  });

  it('decryptPayload 遇到被竄改的內容會拋出例外', () => {
    const { encryptPayload, decryptPayload } = loadModule(VALID_SECRET);
    const encrypted = encryptPayload({ x: 1 });
    const tampered = encrypted.slice(0, -4) + (encrypted.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    expect(() => decryptPayload(tampered)).toThrow();
  });

  it('decryptPayload 遇到格式不符的字串（非本系統加密）會拋出例外', () => {
    const { decryptPayload } = loadModule(VALID_SECRET);
    expect(() => decryptPayload(Buffer.from('random unrelated text').toString('base64'))).toThrow();
  });

  it('encryptPayload 在密鑰未設定時拋出例外', () => {
    const { encryptPayload } = loadModule(undefined);
    expect(() => encryptPayload({ x: 1 })).toThrow();
  });

  it('decryptPayload 在密鑰未設定時拋出例外', () => {
    const { decryptPayload } = loadModule(undefined);
    expect(() => decryptPayload('anything')).toThrow();
  });
});
