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

const sampleData = [{ week: 1, schedule: [], tasks: [], fillStats: [], dateRange: '2025-01-06~10' }];

beforeEach(() => {
  jest.clearAllMocks();
  getIsDbConnected.mockReturnValue(true);
  repo.getConfig.mockResolvedValue({ activeProfile: 'default' });
});

// ── POST /api/schedules ───────────────────────────────────────────────────────

describe('POST /api/schedules', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app)
      .post('/api/schedules')
      .send({ name: '2025-W01', data: sampleData, profile: 'default' });
    expect(res.status).toBe(503);
  });

  it('班表名稱超過 100 字元時回傳 400', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .send({ name: 'a'.repeat(101), data: sampleData, profile: 'default' });
    expect(res.status).toBe(400);
  });

  it('data 非陣列時回傳 400', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .send({ name: '2025-W01', data: 'bad', profile: 'default' });
    expect(res.status).toBe(400);
  });

  it('data 為空陣列時回傳 400', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .send({ name: '2025-W01', data: [], profile: 'default' });
    expect(res.status).toBe(400);
  });

  it('成功儲存班表，回傳 201', async () => {
    repo.saveSchedule.mockResolvedValue();
    const res = await request(app)
      .post('/api/schedules')
      .send({ name: '2025-W01', data: sampleData, profile: 'default' });
    expect(res.status).toBe(201);
    expect(repo.saveSchedule).toHaveBeenCalledWith('default', '2025-W01', sampleData);
  });

  it('未提供 profile 時從 repo.getConfig() 取得', async () => {
    repo.saveSchedule.mockResolvedValue();
    const res = await request(app)
      .post('/api/schedules')
      .send({ name: '2025-W01', data: sampleData });
    expect(res.status).toBe(201);
    expect(repo.getConfig).toHaveBeenCalled();
    expect(repo.saveSchedule).toHaveBeenCalledWith('default', '2025-W01', sampleData);
  });

  it('提供無效 profile 名稱時回傳 400', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .send({ name: '2025-W01', data: sampleData, profile: 'a b' });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/schedules/:name ──────────────────────────────────────────────────

describe('GET /api/schedules/:name', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).get('/api/schedules/2025-W01');
    expect(res.status).toBe(503);
  });

  it('班表名稱超過 100 字元時回傳 400', async () => {
    const name = encodeURIComponent('a'.repeat(101));
    const res = await request(app).get(`/api/schedules/${name}`);
    expect(res.status).toBe(400);
  });

  it('成功取得班表', async () => {
    repo.getSchedule.mockResolvedValue(sampleData);
    const res = await request(app).get('/api/schedules/2025-W01');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleData);
  });

  it('班表不存在時回傳 404', async () => {
    repo.getSchedule.mockResolvedValue(null);
    const res = await request(app).get('/api/schedules/not-exist');
    expect(res.status).toBe(404);
  });

  it('中文班表名稱正確解碼後查詢', async () => {
    repo.getSchedule.mockResolvedValue(sampleData);
    const encoded = encodeURIComponent('春季排班');
    const res = await request(app).get(`/api/schedules/${encoded}`);
    expect(res.status).toBe(200);
    expect(repo.getSchedule).toHaveBeenCalledWith('default', '春季排班');
  });
});

// ── DELETE /api/schedules/:name ───────────────────────────────────────────────

describe('DELETE /api/schedules/:name', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).delete('/api/schedules/2025-W01');
    expect(res.status).toBe(503);
  });

  it('成功刪除班表', async () => {
    repo.deleteSchedule.mockResolvedValue();
    const res = await request(app).delete('/api/schedules/2025-W01');
    expect(res.status).toBe(200);
    expect(repo.deleteSchedule).toHaveBeenCalledWith('default', '2025-W01');
  });

  it('repo 拋出例外時回傳 500', async () => {
    repo.deleteSchedule.mockRejectedValue(new Error('DB error'));
    const res = await request(app).delete('/api/schedules/2025-W01');
    expect(res.status).toBe(500);
  });
});
