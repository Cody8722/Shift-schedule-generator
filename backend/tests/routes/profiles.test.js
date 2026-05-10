'use strict';

process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/db/connect', () => ({
  getIsDbConnected: jest.fn().mockReturnValue(true),
  getHolidaysCollection: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  ensureConfigDocument: jest.fn(),
  getDb: jest.fn(),
}));

jest.mock('../../src/repositories/profileRepository', () => ({
  getConfig: jest.fn(),
  setActiveProfile: jest.fn(),
  createProfile: jest.fn(),
  updateProfileSettings: jest.fn(),
  renameProfile: jest.fn(),
  deleteProfile: jest.fn(),
  saveSchedule: jest.fn(),
  getSchedule: jest.fn(),
  deleteSchedule: jest.fn(),
}));

// ── 測試主體 ──────────────────────────────────────────────────────────────────

const request = require('supertest');
const app = require('../../server');
const { getIsDbConnected } = require('../../src/db/connect');
const repo = require('../../src/repositories/profileRepository');

const minSettings = {
  tasks: [{ name: '早班', count: 1 }],
  personnel: [{ name: '張三' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  getIsDbConnected.mockReturnValue(true);
});

// ── GET /api/profiles ─────────────────────────────────────────────────────────

describe('GET /api/profiles', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).get('/api/profiles');
    expect(res.status).toBe(503);
  });

  it('回傳 repo.getConfig() 的結果', async () => {
    const mockConfig = { activeProfile: 'default', profiles: { default: {} } };
    repo.getConfig.mockResolvedValue(mockConfig);
    const res = await request(app).get('/api/profiles');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockConfig);
  });

  it('config 為 null 時回傳空物件', async () => {
    repo.getConfig.mockResolvedValue(null);
    const res = await request(app).get('/api/profiles');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('repo 拋出例外時回傳 500', async () => {
    repo.getConfig.mockRejectedValue(new Error('DB read error'));
    const res = await request(app).get('/api/profiles');
    expect(res.status).toBe(500);
  });
});

// ── PUT /api/profiles/active ──────────────────────────────────────────────────

describe('PUT /api/profiles/active', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).put('/api/profiles/active').send({ name: 'test' });
    expect(res.status).toBe(503);
  });

  it('成功更新作用中設定檔', async () => {
    repo.setActiveProfile.mockResolvedValue();
    const res = await request(app).put('/api/profiles/active').send({ name: 'my-profile' });
    expect(res.status).toBe(200);
    expect(repo.setActiveProfile).toHaveBeenCalledWith('my-profile');
  });
});

// ── POST /api/profiles ────────────────────────────────────────────────────────

describe('POST /api/profiles', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).post('/api/profiles').send({ name: 'valid' });
    expect(res.status).toBe(503);
  });

  it('名稱含特殊符號（/）時回傳 400', async () => {
    const res = await request(app).post('/api/profiles').send({ name: 'a/b' });
    expect(res.status).toBe(400);
  });

  it('名稱含空格時回傳 400', async () => {
    const res = await request(app).post('/api/profiles').send({ name: 'hello world' });
    expect(res.status).toBe(400);
  });

  it('合法名稱時回傳 201', async () => {
    repo.createProfile.mockResolvedValue();
    const res = await request(app).post('/api/profiles').send({ name: 'valid-profile' });
    expect(res.status).toBe(201);
  });

  it('repo 拋出例外時回傳 500', async () => {
    repo.createProfile.mockRejectedValue(new Error('already exists'));
    const res = await request(app).post('/api/profiles').send({ name: 'valid' });
    expect(res.status).toBe(500);
  });
});

// ── PUT /api/profiles/:name ───────────────────────────────────────────────────

describe('PUT /api/profiles/:name', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).put('/api/profiles/test').send({ settings: minSettings });
    expect(res.status).toBe(503);
  });

  it('settings 無效（tasks 非陣列）時回傳 400', async () => {
    const res = await request(app)
      .put('/api/profiles/test')
      .send({ settings: { tasks: 'bad', personnel: [] } });
    expect(res.status).toBe(400);
  });

  it('成功更新設定檔', async () => {
    repo.updateProfileSettings.mockResolvedValue();
    const res = await request(app).put('/api/profiles/test').send({ settings: minSettings });
    expect(res.status).toBe(200);
    expect(repo.updateProfileSettings).toHaveBeenCalled();
  });

  it('設定檔不存在時（status=404）回傳 404', async () => {
    const err = Object.assign(new Error('找不到'), { status: 404 });
    repo.updateProfileSettings.mockRejectedValue(err);
    const res = await request(app).put('/api/profiles/test').send({ settings: minSettings });
    expect(res.status).toBe(404);
  });

  it('中文名稱正確解碼後更新', async () => {
    repo.updateProfileSettings.mockResolvedValue();
    const encoded = encodeURIComponent('早班組');
    const res = await request(app).put(`/api/profiles/${encoded}`).send({ settings: minSettings });
    expect(res.status).toBe(200);
    expect(repo.updateProfileSettings).toHaveBeenCalledWith('早班組', minSettings);
  });
});

// ── PUT /api/profiles/:name/rename ────────────────────────────────────────────

describe('PUT /api/profiles/:name/rename', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).put('/api/profiles/old/rename').send({ newName: 'new' });
    expect(res.status).toBe(503);
  });

  it('新名稱含空格時回傳 400', async () => {
    const res = await request(app)
      .put('/api/profiles/valid/rename')
      .send({ newName: 'a b' });
    expect(res.status).toBe(400);
  });

  it('成功重新命名', async () => {
    repo.renameProfile.mockResolvedValue();
    const res = await request(app)
      .put('/api/profiles/old-name/rename')
      .send({ newName: 'new-name' });
    expect(res.status).toBe(200);
    expect(repo.renameProfile).toHaveBeenCalledWith('old-name', 'new-name');
  });
});

// ── DELETE /api/profiles/:name ────────────────────────────────────────────────

describe('DELETE /api/profiles/:name', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).delete('/api/profiles/test');
    expect(res.status).toBe(503);
  });

  it('名稱含空格（URL 編碼後）時回傳 400', async () => {
    const res = await request(app).delete(`/api/profiles/${encodeURIComponent('a b')}`);
    expect(res.status).toBe(400);
  });

  it('成功刪除設定檔', async () => {
    repo.deleteProfile.mockResolvedValue();
    const res = await request(app).delete('/api/profiles/test');
    expect(res.status).toBe(200);
    expect(repo.deleteProfile).toHaveBeenCalledWith('test');
  });

  it('repo 拋出 status=400 錯誤時轉發 400', async () => {
    const err = Object.assign(new Error('無法刪除唯一設定檔'), { status: 400 });
    repo.deleteProfile.mockRejectedValue(err);
    const res = await request(app).delete('/api/profiles/test');
    expect(res.status).toBe(400);
  });
});
