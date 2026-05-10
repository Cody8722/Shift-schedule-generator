'use strict';

process.env.NODE_ENV = 'test';

// ── Mocks（必須在 require 之前宣告，Jest 會提升至頂端）──────────────────────

jest.mock('../../src/db/connect', () => ({
  getIsDbConnected: jest.fn().mockReturnValue(true),
  getHolidaysCollection: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  ensureConfigDocument: jest.fn(),
  getDb: jest.fn(),
}));

jest.mock('../../src/services/holidayService', () => ({
  holidaysCache: { clear: jest.fn(), delete: jest.fn() },
  getWeekInfo: jest.fn(),
  getHolidaysForYear: jest.fn(),
  seedHolidays: jest.fn(),
  refreshHolidaysFromCDN: jest.fn(),
}));

// ── 測試主體 ──────────────────────────────────────────────────────────────────

const request = require('supertest');
const app = require('../../server');
const { getIsDbConnected, getHolidaysCollection } = require('../../src/db/connect');
const { getWeekInfo, getHolidaysForYear } = require('../../src/services/holidayService');

/** 建立可覆寫欄位的 mock collection */
const makeMockCol = (overrides = {}) => ({
  find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 3 }),
  countDocuments: jest.fn().mockResolvedValue(10),
  updateOne: jest.fn().mockResolvedValue({}),
  deleteOne: jest.fn().mockResolvedValue({}),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  getIsDbConnected.mockReturnValue(true);
  getHolidaysCollection.mockReturnValue(makeMockCol());
});

// ── GET /api/holidays/:year ───────────────────────────────────────────────────

describe('GET /api/holidays/:year', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).get('/api/holidays/2025');
    expect(res.status).toBe(503);
  });

  it('回傳當年度假日清單（date/name 格式）', async () => {
    getHolidaysCollection.mockReturnValue(
      makeMockCol({
        find: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([
            { _id: '2025-01-01', name: '元旦', isHoliday: true },
          ]),
        }),
      })
    );
    const res = await request(app).get('/api/holidays/2025');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toEqual({ date: '2025-01-01', name: '元旦' });
  });

  it('DB 查詢失敗時回傳 500', async () => {
    getHolidaysCollection.mockReturnValue(
      makeMockCol({
        find: jest.fn().mockReturnValue({
          toArray: jest.fn().mockRejectedValue(new Error('DB error')),
        }),
      })
    );
    const res = await request(app).get('/api/holidays/2025');
    expect(res.status).toBe(500);
  });
});

// ── POST /api/holidays/reseed ─────────────────────────────────────────────────

describe('POST /api/holidays/reseed', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app).post('/api/holidays/reseed');
    expect(res.status).toBe(503);
  });

  it('成功重新植入後回傳 message 與 count', async () => {
    getHolidaysForYear.mockResolvedValue(new Map());
    const res = await request(app).post('/api/holidays/reseed');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('count');
    expect(getHolidaysForYear).toHaveBeenCalled();
  });

  it('getHolidaysForYear 失敗時回傳 500', async () => {
    getHolidaysForYear.mockRejectedValue(new Error('fetch failed'));
    const res = await request(app).post('/api/holidays/reseed');
    expect(res.status).toBe(500);
  });
});

// ── PUT /api/holidays ─────────────────────────────────────────────────────────

describe('PUT /api/holidays', () => {
  it('DB 未連線時回傳 503', async () => {
    getIsDbConnected.mockReturnValue(false);
    const res = await request(app)
      .put('/api/holidays')
      .send({ date: '2025-01-01', name: '元旦', isHoliday: true });
    expect(res.status).toBe(503);
  });

  it('缺少 date 欄位時回傳 400', async () => {
    const res = await request(app).put('/api/holidays').send({ name: '元旦' });
    expect(res.status).toBe(400);
  });

  it('isHoliday=true 時呼叫 updateOne（upsert）', async () => {
    const col = makeMockCol();
    getHolidaysCollection.mockReturnValue(col);
    const res = await request(app)
      .put('/api/holidays')
      .send({ date: '2025-01-01', name: '元旦', isHoliday: true });
    expect(res.status).toBe(200);
    expect(col.updateOne).toHaveBeenCalled();
    expect(col.deleteOne).not.toHaveBeenCalled();
  });

  it('isHoliday=false 時呼叫 deleteOne', async () => {
    const col = makeMockCol();
    getHolidaysCollection.mockReturnValue(col);
    const res = await request(app)
      .put('/api/holidays')
      .send({ date: '2025-02-01', isHoliday: false });
    expect(res.status).toBe(200);
    expect(col.deleteOne).toHaveBeenCalled();
    expect(col.updateOne).not.toHaveBeenCalled();
  });
});

// ── GET /api/holidays-in-range ────────────────────────────────────────────────

describe('GET /api/holidays-in-range', () => {
  it('缺少 startWeek 時回傳 400', async () => {
    const res = await request(app).get('/api/holidays-in-range?numWeeks=1');
    expect(res.status).toBe(400);
  });

  it('缺少 numWeeks 時回傳 400', async () => {
    const res = await request(app).get('/api/holidays-in-range?startWeek=2025-W01');
    expect(res.status).toBe(400);
  });

  it('正常回傳範圍內的假日清單', async () => {
    getWeekInfo.mockReturnValue({
      weekDates: ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'],
    });
    getHolidaysForYear.mockResolvedValue(new Map([['2025-01-06', '元旦補班']]));
    const res = await request(app).get('/api/holidays-in-range?startWeek=2025-W01&numWeeks=1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContainEqual({ date: '2025-01-06', name: '元旦補班' });
  });

  it('範圍內無假日時回傳空陣列', async () => {
    getWeekInfo.mockReturnValue({ weekDates: ['2025-03-10', '2025-03-11'] });
    getHolidaysForYear.mockResolvedValue(new Map());
    const res = await request(app).get('/api/holidays-in-range?startWeek=2025-W11&numWeeks=1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
