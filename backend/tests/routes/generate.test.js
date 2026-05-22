'use strict';

process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/db/connect', () => ({
  getIsDbConnected: jest.fn().mockReturnValue(false),
  getHolidaysCollection: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  ensureConfigDocument: jest.fn(),
  getDb: jest.fn(),
  getSchoolEventsCollection: jest.fn(),
  getConfigCollection: jest.fn(),
}));

jest.mock('../../src/services/holidayService', () => ({
  holidaysCache: new Map(),
  getWeekInfo: jest.fn(),
  getHolidaysForYear: jest.fn().mockResolvedValue(new Map()),
  seedHolidays: jest.fn(),
  refreshHolidaysFromCDN: jest.fn(),
}));

jest.mock('../../src/services/scheduleAlgorithm', () => ({
  generateWeeklySchedule: jest.fn(),
}));

jest.mock('../../src/services/scheduleRenderer', () => ({
  generateScheduleHtml: jest.fn().mockReturnValue('<html>schedule</html>'),
}));

jest.mock('../../src/services/schoolCalendar', () => ({
  getSchoolEvents: jest.fn().mockResolvedValue({ cached: false, data: [] }),
  schoolEventsCache: { data: null, fetchedAt: 0 },
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

// ── 測試主體 ──────────────────────────────────────────────────────────────────

const request = require('supertest');
const app = require('../../server');
const { generateWeeklySchedule } = require('../../src/services/scheduleAlgorithm');
const { generateScheduleHtml } = require('../../src/services/scheduleRenderer');
const { getWeekInfo, getHolidaysForYear } = require('../../src/services/holidayService');

const validBody = {
  settings: {
    tasks: [{ name: '早班', count: 1 }],
    personnel: [{ name: '張三', maxShifts: 5 }, { name: '李四', maxShifts: 5 }],
  },
  startWeek: '2025-W01',
  numWeeks: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  getWeekInfo.mockReturnValue({
    weekDates: ['20250106', '20250107', '20250108', '20250109', '20250110'],
    weekDayDates: ['01/06', '01/07', '01/08', '01/09', '01/10'],
  });
  getHolidaysForYear.mockResolvedValue(new Map());
  generateWeeklySchedule.mockReturnValue({
    weeklySchedule: [[[]]],
    fillStats: [{ name: '早班', priority: 1, filled: 1, needed: 1, ok: true }],
    weekShiftCounts: new Map(),
  });
  generateScheduleHtml.mockReturnValue('<html>ok</html>');
});

// ── POST /api/generate-schedule 錯誤路徑 ─────────────────────────────────────

describe('POST /api/generate-schedule — 錯誤路徑', () => {
  it('generateWeeklySchedule 拋出例外時回傳 500', async () => {
    generateWeeklySchedule.mockImplementation(() => {
      throw new Error('algorithm crash');
    });

    const res = await request(app).post('/api/generate-schedule').send(validBody);
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('message');
  });

  it('getHolidaysForYear 拋出例外時回傳 500', async () => {
    getHolidaysForYear.mockRejectedValue(new Error('db error'));

    const res = await request(app).post('/api/generate-schedule').send(validBody);
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('message');
  });

  it('generateScheduleHtml 拋出例外時回傳 500', async () => {
    generateScheduleHtml.mockImplementation(() => {
      throw new Error('render crash');
    });

    const res = await request(app).post('/api/generate-schedule').send(validBody);
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('message');
  });
});

// ── POST /api/generate-schedule 成功路徑（with mocks）────────────────────────

describe('POST /api/generate-schedule — 成功路徑', () => {
  it('回傳 data 陣列與 html 字串', async () => {
    const res = await request(app).post('/api/generate-schedule').send(validBody);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.html).toBe('string');
  });

  it('多週班表呼叫對應次數的 generateWeeklySchedule', async () => {
    await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, numWeeks: 3 });
    expect(generateWeeklySchedule).toHaveBeenCalledTimes(3);
  });

  it('weekShiftCounts 累積到 cumulativeShifts（跨週公平性）', async () => {
    // 在第二次呼叫時快照 cumulativeShifts 的當下值（Map 是 by-reference，事後讀會取到最終值）
    const snapshotAtSecondCall = new Map();
    generateWeeklySchedule.mockImplementation((_s, _d, cumulative) => {
      if (generateWeeklySchedule.mock.calls.length === 2) {
        for (const [k, v] of cumulative) snapshotAtSecondCall.set(k, v);
      }
      return {
        weeklySchedule: [[[]]],
        fillStats: [],
        weekShiftCounts: new Map([['張三', 2]]),
      };
    });

    await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, numWeeks: 2 });

    expect(snapshotAtSecondCall.get('張三')).toBe(2);
  });

  it('activeHolidays 正確標記為非排班日', async () => {
    await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, activeHolidays: ['20250106'] });

    const callArgs = generateWeeklySchedule.mock.calls[0];
    const scheduleDays = callArgs[1];
    expect(scheduleDays[0].shouldSchedule).toBe(false);
    expect(scheduleDays[0].date).toBe('20250106');
  });
});

// ── POST /api/render-schedule ──────────────────────────────────────────────────

describe('POST /api/render-schedule', () => {
  it('generateScheduleHtml 拋出例外時回傳 500', async () => {
    generateScheduleHtml.mockImplementation(() => {
      throw new Error('render error');
    });

    const sampleData = [{ schedule: [], tasks: [], fillStats: [], dateRange: '01/06 - 01/10' }];
    const res = await request(app).post('/api/render-schedule').send(sampleData);
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('message');
  });

  it('傳入有效陣列時回傳 html', async () => {
    const sampleData = [{ schedule: [], tasks: [], fillStats: [], dateRange: '01/06 - 01/10' }];
    const res = await request(app).post('/api/render-schedule').send(sampleData);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('html');
  });
});
