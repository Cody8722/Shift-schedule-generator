'use strict';

process.env.NODE_ENV = 'test';

// ── Mocks（必須在 require 之前宣告，Jest 會提升至頂端）──────────────────────

jest.mock('../../src/db/connect', () => ({
  getIsDbConnected: jest.fn().mockReturnValue(true),
  getSchoolEventsCollection: jest.fn(),
  getHolidaysCollection: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  ensureConfigDocument: jest.fn(),
}));

jest.mock('../../src/services/holidayService', () => ({
  holidaysCache: { clear: jest.fn(), delete: jest.fn() },
  getWeekInfo: jest.fn(),
  getHolidaysForYear: jest.fn(),
  seedHolidays: jest.fn(),
  refreshHolidaysFromCDN: jest.fn(),
}));

jest.mock('../../src/services/schoolCalendar', () => ({
  getSchoolEvents: jest.fn(),
  schoolEventsCache: { data: null, fetchedAt: 0 },
}));

// ── 測試主體 ──────────────────────────────────────────────────────────────────

const request = require('supertest');
const app = require('../../server');
const { getIsDbConnected, getSchoolEventsCollection } = require('../../src/db/connect');
const { getSchoolEvents, schoolEventsCache } = require('../../src/services/schoolCalendar');

const SAMPLE_EVENTS = [
  { startDate: '20250325', endDate: '20250326', name: '一段', type: 'exam' },
  { startDate: '20250512', endDate: '20250513', name: '二段', type: 'exam' },
  { startDate: '20250626', endDate: '20250630', name: '期末考', type: 'exam' },
];

const makeMockCol = (overrides = {}) => ({
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  getIsDbConnected.mockReturnValue(true);
  getSchoolEventsCollection.mockReturnValue(makeMockCol());
  getSchoolEvents.mockResolvedValue({ cached: false, data: SAMPLE_EVENTS });
  schoolEventsCache.data = null;
  schoolEventsCache.fetchedAt = 0;
});

// ── GET /api/school-events ────────────────────────────────────────────────────

describe('GET /api/school-events', () => {
  it('回傳事件陣列', async () => {
    const res = await request(app).get('/api/school-events');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual(SAMPLE_EVENTS);
    expect(getSchoolEvents).toHaveBeenCalled();
  });

  it('快取命中時同樣回傳 200', async () => {
    getSchoolEvents.mockResolvedValue({ cached: true, data: SAMPLE_EVENTS });
    const res = await request(app).get('/api/school-events');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SAMPLE_EVENTS);
  });

  it('getSchoolEvents 失敗時回傳 500', async () => {
    getSchoolEvents.mockRejectedValue(new Error('fetch failed'));
    const res = await request(app).get('/api/school-events');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('message');
  });
});

// ── POST /api/school-events/refresh ──────────────────────────────────────────

describe('POST /api/school-events/refresh', () => {
  it('DB 連線時清除集合並回傳新資料', async () => {
    const col = makeMockCol();
    getSchoolEventsCollection.mockReturnValue(col);

    const res = await request(app).post('/api/school-events/refresh');

    expect(res.status).toBe(200);
    expect(col.deleteMany).toHaveBeenCalled();
    expect(getSchoolEvents).toHaveBeenCalled();
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('count', SAMPLE_EVENTS.length);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('DB 未連線時不呼叫 deleteMany，仍清除記憶體快取並回傳 200', async () => {
    getIsDbConnected.mockReturnValue(false);
    const col = makeMockCol();
    getSchoolEventsCollection.mockReturnValue(col);

    const res = await request(app).post('/api/school-events/refresh');

    expect(res.status).toBe(200);
    expect(col.deleteMany).not.toHaveBeenCalled();
    expect(getSchoolEvents).toHaveBeenCalled();
  });

  it('refresh 後記憶體快取被清空再重新抓取', async () => {
    schoolEventsCache.data = SAMPLE_EVENTS;
    schoolEventsCache.fetchedAt = Date.now();

    await request(app).post('/api/school-events/refresh');

    expect(schoolEventsCache.data).toBeNull();
    expect(schoolEventsCache.fetchedAt).toBe(0);
  });

  it('getSchoolEvents 失敗時回傳 500', async () => {
    getSchoolEvents.mockRejectedValue(new Error('network error'));
    const res = await request(app).post('/api/school-events/refresh');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('message');
  });
});
