'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../../src/db/connect', () => ({
  getIsDbConnected: jest.fn().mockReturnValue(true),
  getScheduleSharesCollection: jest.fn(),
}));

jest.mock('../../src/repositories/profileRepository', () => ({
  getSchedule: jest.fn(),
}));

jest.mock('../../src/repositories/shareRepository', () => ({
  createShare: jest.fn(),
  getShare: jest.fn(),
}));

const request = require('supertest');
const app = require('../../server');
const { getIsDbConnected } = require('../../src/db/connect');
const profileRepo = require('../../src/repositories/profileRepository');
const shareRepo = require('../../src/repositories/shareRepository');

const SAMPLE_SCHEDULE = [
  {
    schedule: [[['張三', '李四']], [['張三']], [['李四']], [[]], [['張三', '李四']]],
    fillStats: [{ name: '素描教室', priority: 1, needed: 2, filled: 2, ok: true }],
    tasks: [{ name: '素描教室', count: 2, priority: 1 }],
    dateRange: '08/31 - 09/04',
    weekDayDates: ['08/31', '09/01', '09/02', '09/03', '09/04'],
    scheduleDays: [
      { date: '20260831', shouldSchedule: true, description: '' },
      { date: '20260901', shouldSchedule: true, description: '' },
      { date: '20260902', shouldSchedule: true, description: '' },
      { date: '20260903', shouldSchedule: true, description: '' },
      { date: '20260904', shouldSchedule: true, description: '' },
    ],
    color: { header: '#0284c7', row: '#f0f9ff' },
    weekIndex: 0,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  getIsDbConnected.mockReturnValue(true);
});

describe('POST /api/schedule-shares', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).post('/api/schedule-shares').send({ profile: 'default', scheduleName: 'A' });
    expect(res.status).toBe(503);
  });

  it('profile 名稱不合法時回傳 400', async () => {
    const res = await request(app).post('/api/schedule-shares').send({ profile: 'a/b', scheduleName: 'A' });
    expect(res.status).toBe(400);
  });

  it('scheduleName 不合法時回傳 400', async () => {
    const res = await request(app).post('/api/schedule-shares').send({ profile: 'default', scheduleName: '' });
    expect(res.status).toBe(400);
  });

  it('personFilter 不是字串時回傳 400', async () => {
    const res = await request(app)
      .post('/api/schedule-shares')
      .send({ profile: 'default', scheduleName: 'A', personFilter: 123 });
    expect(res.status).toBe(400);
  });

  it('找不到指定班表時回傳 404', async () => {
    profileRepo.getSchedule.mockResolvedValue(null);
    const res = await request(app).post('/api/schedule-shares').send({ profile: 'default', scheduleName: 'A' });
    expect(res.status).toBe(404);
  });

  it('成功時回傳 201 與 token', async () => {
    profileRepo.getSchedule.mockResolvedValue(SAMPLE_SCHEDULE);
    shareRepo.createShare.mockResolvedValue('abc123token');
    const res = await request(app)
      .post('/api/schedule-shares')
      .send({ profile: 'default', scheduleName: 'A', personFilter: '張三' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBe('abc123token');
    expect(shareRepo.createShare).toHaveBeenCalledWith('default', 'A', '張三', null);
  });

  it('不帶 personFilter/expiresInDays 時以 null 建立（永久分享整份班表）', async () => {
    profileRepo.getSchedule.mockResolvedValue(SAMPLE_SCHEDULE);
    shareRepo.createShare.mockResolvedValue('token2');
    await request(app).post('/api/schedule-shares').send({ profile: 'default', scheduleName: 'A' });
    expect(shareRepo.createShare).toHaveBeenCalledWith('default', 'A', null, null);
  });

  it('帶合法 expiresInDays 時一併傳給 createShare', async () => {
    profileRepo.getSchedule.mockResolvedValue(SAMPLE_SCHEDULE);
    shareRepo.createShare.mockResolvedValue('token3');
    await request(app)
      .post('/api/schedule-shares')
      .send({ profile: 'default', scheduleName: 'A', expiresInDays: 7 });
    expect(shareRepo.createShare).toHaveBeenCalledWith('default', 'A', null, 7);
  });

  it('expiresInDays 不是整數時回傳 400', async () => {
    const res = await request(app)
      .post('/api/schedule-shares')
      .send({ profile: 'default', scheduleName: 'A', expiresInDays: 7.5 });
    expect(res.status).toBe(400);
  });

  it('expiresInDays 超出 1-365 範圍時回傳 400', async () => {
    const res = await request(app)
      .post('/api/schedule-shares')
      .send({ profile: 'default', scheduleName: 'A', expiresInDays: 400 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/schedule-shares/:token', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).get('/api/schedule-shares/xxx');
    expect(res.status).toBe(503);
  });

  it('token 不存在時回傳 404', async () => {
    shareRepo.getShare.mockResolvedValue(null);
    const res = await request(app).get('/api/schedule-shares/xxx');
    expect(res.status).toBe(404);
  });

  it('token 存在但 expiresAt 已過期時回傳 404，且不去查班表資料', async () => {
    shareRepo.getShare.mockResolvedValue({
      profile: 'default',
      scheduleName: 'A',
      personFilter: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app).get('/api/schedule-shares/xxx');
    expect(res.status).toBe(404);
    expect(res.body.message).toContain('過期');
    expect(profileRepo.getSchedule).not.toHaveBeenCalled();
  });

  it('token 存在且 expiresAt 尚未到期時正常回傳', async () => {
    shareRepo.getShare.mockResolvedValue({
      profile: 'default',
      scheduleName: 'A',
      personFilter: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
    profileRepo.getSchedule.mockResolvedValue(SAMPLE_SCHEDULE);
    const res = await request(app).get('/api/schedule-shares/xxx');
    expect(res.status).toBe(200);
  });

  it('token 存在但班表已被刪除時回傳 404', async () => {
    shareRepo.getShare.mockResolvedValue({ profile: 'default', scheduleName: 'A', personFilter: null });
    profileRepo.getSchedule.mockResolvedValue(null);
    const res = await request(app).get('/api/schedule-shares/xxx');
    expect(res.status).toBe(404);
  });

  it('personFilter 為 null 時回傳完整班表的 HTML（所有人都看得到）', async () => {
    shareRepo.getShare.mockResolvedValue({ profile: 'default', scheduleName: 'A', personFilter: null });
    profileRepo.getSchedule.mockResolvedValue(SAMPLE_SCHEDULE);
    const res = await request(app).get('/api/schedule-shares/xxx');
    expect(res.status).toBe(200);
    expect(res.body.html).toContain('張三');
    expect(res.body.html).toContain('李四');
    expect(res.body.personFilter).toBeNull();
  });

  it('personFilter 有指定時，回傳的 HTML 只包含該人員的名字，其他人被過濾掉', async () => {
    shareRepo.getShare.mockResolvedValue({ profile: 'default', scheduleName: 'A', personFilter: '張三' });
    profileRepo.getSchedule.mockResolvedValue(SAMPLE_SCHEDULE);
    const res = await request(app).get('/api/schedule-shares/xxx');
    expect(res.status).toBe(200);
    expect(res.body.html).toContain('張三');
    expect(res.body.html).not.toContain('李四');
    expect(res.body.personFilter).toBe('張三');
  });
});
