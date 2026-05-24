'use strict';

process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/db/connect', () => ({
  getIsDbConnected: jest.fn(),
  getHolidaysCollection: jest.fn(),
  getConfigCollection: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  ensureConfigDocument: jest.fn(),
  getDb: jest.fn(),
  getSchoolEventsCollection: jest.fn(),
}));

jest.mock('../../src/services/holidayService', () => ({
  holidaysCache: new Map(),
  getWeekInfo: jest.fn(),
  getHolidaysForYear: jest.fn().mockResolvedValue(new Map()),
  seedHolidays: jest.fn(),
  refreshHolidaysFromCDN: jest.fn(),
}));

jest.mock('../../src/repositories/profileRepository', () => ({
  getConfig: jest.fn().mockResolvedValue({ activeProfile: 'default' }),
  setActiveProfile: jest.fn(),
  createProfile: jest.fn(),
  updateProfileSettings: jest.fn(),
  renameProfile: jest.fn(),
  deleteProfile: jest.fn(),
  saveSchedule: jest.fn(),
  getSchedule: jest.fn(),
  deleteSchedule: jest.fn(),
}));

jest.mock('../../src/services/schoolCalendar', () => ({
  getSchoolEvents: jest.fn(),
  schoolEventsCache: { data: null, fetchedAt: 0 },
}));

// ── 測試主體 ──────────────────────────────────────────────────────────────────

const request = require('supertest');
const app = require('../../server');
const { getIsDbConnected, getHolidaysCollection, getConfigCollection } = require('../../src/db/connect');
const { holidaysCache } = require('../../src/services/holidayService');

beforeEach(() => {
  jest.clearAllMocks();
  holidaysCache.clear();
});

describe('GET /api/status', () => {
  it('DB 未連線時回傳 disconnected，不含統計欄位', async () => {
    getIsDbConnected.mockReturnValue(false);

    const res = await request(app).get('/api/status');

    expect(res.status).toBe(200);
    expect(res.body.server).toBe('running');
    expect(res.body.database).toBe('disconnected');
    expect(res.body).not.toHaveProperty('holidaysCount');
    expect(res.body).not.toHaveProperty('profilesCount');
  });

  it('DB 連線時回傳 connected 並帶統計資料', async () => {
    getIsDbConnected.mockReturnValue(true);
    getHolidaysCollection.mockReturnValue({
      countDocuments: jest.fn().mockResolvedValue(47),
    });
    getConfigCollection.mockReturnValue({
      countDocuments: jest.fn().mockResolvedValue(3),
    });
    holidaysCache.set(2025, new Map());
    holidaysCache.set(2026, new Map());

    const res = await request(app).get('/api/status');

    expect(res.status).toBe(200);
    expect(res.body.database).toBe('connected');
    expect(res.body.holidaysCount).toBe(47);
    expect(res.body.profilesCount).toBe(3);
    expect(res.body.cacheSize).toBe(2);
  });

  it('DB 連線但 countDocuments 拋出例外時回傳 dbError', async () => {
    getIsDbConnected.mockReturnValue(true);
    getHolidaysCollection.mockReturnValue({
      countDocuments: jest.fn().mockRejectedValue(new Error('query timeout')),
    });

    const res = await request(app).get('/api/status');

    expect(res.status).toBe(200);
    expect(res.body.database).toBe('connected');
    expect(res.body.dbError).toBe('query timeout');
  });
});
