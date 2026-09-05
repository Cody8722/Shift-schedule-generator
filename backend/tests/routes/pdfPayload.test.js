'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../../src/services/pdfPayloadCrypto', () => ({
  isConfigured: jest.fn(),
  encryptPayload: jest.fn(),
  decryptPayload: jest.fn(),
}));

const request = require('supertest');
const app = require('../../server');
const { isConfigured, encryptPayload, decryptPayload } = require('../../src/services/pdfPayloadCrypto');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/pdf-payload/encrypt', () => {
  it('未設定金鑰時回傳 503', async () => {
    isConfigured.mockReturnValue(false);
    const res = await request(app).post('/api/pdf-payload/encrypt').send({ data: { a: 1 } });
    expect(res.status).toBe(503);
    expect(encryptPayload).not.toHaveBeenCalled();
  });

  it('缺少 data 欄位時回傳 400', async () => {
    isConfigured.mockReturnValue(true);
    const res = await request(app).post('/api/pdf-payload/encrypt').send({});
    expect(res.status).toBe(400);
  });

  it('成功加密時回傳 payload 字串', async () => {
    isConfigured.mockReturnValue(true);
    encryptPayload.mockReturnValue('encrypted-base64-string');
    const res = await request(app).post('/api/pdf-payload/encrypt').send({ data: { a: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.payload).toBe('encrypted-base64-string');
    expect(encryptPayload).toHaveBeenCalledWith({ a: 1 });
  });

  it('加密過程拋出例外時回傳 500', async () => {
    isConfigured.mockReturnValue(true);
    encryptPayload.mockImplementation(() => { throw new Error('boom'); });
    const res = await request(app).post('/api/pdf-payload/encrypt').send({ data: { a: 1 } });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/pdf-payload/decrypt', () => {
  it('未設定金鑰時回傳 503', async () => {
    isConfigured.mockReturnValue(false);
    const res = await request(app).post('/api/pdf-payload/decrypt').send({ payload: 'xxx' });
    expect(res.status).toBe(503);
    expect(decryptPayload).not.toHaveBeenCalled();
  });

  it('缺少 payload 欄位時回傳 400', async () => {
    isConfigured.mockReturnValue(true);
    const res = await request(app).post('/api/pdf-payload/decrypt').send({});
    expect(res.status).toBe(400);
  });

  it('payload 不是字串時回傳 400', async () => {
    isConfigured.mockReturnValue(true);
    const res = await request(app).post('/api/pdf-payload/decrypt').send({ payload: 123 });
    expect(res.status).toBe(400);
  });

  it('成功解密時回傳 data', async () => {
    isConfigured.mockReturnValue(true);
    decryptPayload.mockReturnValue({ a: 1 });
    const res = await request(app).post('/api/pdf-payload/decrypt').send({ payload: 'xxx' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ a: 1 });
  });

  it('解密失敗（竄改或非本系統匯出的 PDF）時回傳 400', async () => {
    isConfigured.mockReturnValue(true);
    decryptPayload.mockImplementation(() => { throw new Error('bad auth tag'); });
    const res = await request(app).post('/api/pdf-payload/decrypt').send({ payload: 'xxx' });
    expect(res.status).toBe(400);
  });
});
