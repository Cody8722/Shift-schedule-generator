'use strict';

process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/db/connect', () => ({
  getIsDbConnected: jest.fn(),
  getHolidaysCollection: jest.fn(),
}));

jest.mock('fs', () => ({
  promises: {
    access: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    readFile: jest.fn().mockResolvedValue('[]'),
  },
}));

// ── 共用工具 ───────────────────────────────────────────────────────────────────

const { getIsDbConnected, getHolidaysCollection } = require('../../src/db/connect');
const fsMock = require('fs');

const {
  holidaysCache,
  getWeekInfo,
  getHolidaysForYear,
  refreshHolidaysFromCDN,
  seedHolidays,
} = require('../../src/services/holidayService');

const makeCol = (overrides = {}) => {
  const col = {
    toArray: jest.fn().mockResolvedValue([]),
    insertMany: jest.fn().mockResolvedValue({ insertedCount: 0 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };
  col.find = jest.fn().mockReturnValue(col);
  return { ...col, ...overrides };
};

beforeEach(() => {
  jest.clearAllMocks();
  holidaysCache.clear();
  global.fetch = jest.fn();
});

// ── getWeekInfo ───────────────────────────────────────────────────────────────

describe('getWeekInfo', () => {
  it('2025-W01 第 0 週：起始日為 12/30（Mon）', () => {
    const { weekDates, weekDayDates } = getWeekInfo('2025-W01', 0);
    expect(weekDates).toHaveLength(5);
    expect(weekDayDates).toHaveLength(5);
    expect(weekDates[0]).toBe('20241230');
    expect(weekDates[4]).toBe('20250103');
    expect(weekDayDates[0]).toBe('12/30');
  });

  it('weekIndex=1 往後移一週', () => {
    const { weekDates } = getWeekInfo('2025-W01', 1);
    expect(weekDates[0]).toBe('20250106');
    expect(weekDates[4]).toBe('20250110');
  });

  it('2026-W01 起始日為 12/29（Mon）', () => {
    const { weekDates } = getWeekInfo('2026-W01', 0);
    expect(weekDates[0]).toBe('20251229');
  });

  it('跨年週：weekDates 含兩個不同年份', () => {
    const { weekDates } = getWeekInfo('2025-W01', 0);
    const years = new Set(weekDates.map((d) => d.slice(0, 4)));
    expect(years.size).toBe(2);
  });

  it('回傳的 weekDayDates 格式為 MM/DD', () => {
    const { weekDayDates } = getWeekInfo('2025-W10', 0);
    weekDayDates.forEach((d) => expect(d).toMatch(/^\d{2}\/\d{2}$/));
  });
});

// ── getHolidaysForYear ────────────────────────────────────────────────────────

describe('getHolidaysForYear', () => {
  it('快取命中時直接回傳，不查 DB', async () => {
    const cached = new Map([['20250101', '元旦']]);
    holidaysCache.set(2025, cached);
    const result = await getHolidaysForYear(2025);
    expect(result).toBe(cached);
    expect(getIsDbConnected).not.toHaveBeenCalled();
  });

  it('DB 未連線時回傳空 Map', async () => {
    getIsDbConnected.mockReturnValue(false);
    const result = await getHolidaysForYear(2025);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('DB 有資料時回傳假日 Map 並寫入快取', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.toArray.mockResolvedValue([
      { _id: '20250101', name: '元旦', isHoliday: true },
      { _id: '20250228', name: '和平紀念日', isHoliday: true },
    ]);
    getHolidaysCollection.mockReturnValue(col);

    const result = await getHolidaysForYear(2025);
    expect(result.size).toBe(2);
    expect(result.get('20250101')).toBe('元旦');
    expect(holidaysCache.has(2025)).toBe(true);
  });

  it('DB 無資料時改從 CDN 抓取', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.toArray.mockResolvedValue([]); // DB 空
    getHolidaysCollection.mockReturnValue(col);

    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([
        { date: '20250101', description: '元旦', isHoliday: true },
        { date: '20250102', description: '工作日', isHoliday: false },
      ]),
    });

    const result = await getHolidaysForYear(2025);
    expect(result.size).toBe(1);
    expect(result.has('20250101')).toBe(true);
    expect(result.has('20250102')).toBe(false);
  });

  it('CDN 回應 !ok 時回傳空 Map', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.toArray.mockResolvedValue([]);
    getHolidaysCollection.mockReturnValue(col);
    global.fetch.mockResolvedValue({ ok: false });

    const result = await getHolidaysForYear(2025);
    expect(result.size).toBe(0);
  });

  it('CDN 拋出例外時回傳空 Map', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.toArray.mockResolvedValue([]);
    getHolidaysCollection.mockReturnValue(col);
    global.fetch.mockRejectedValue(new Error('network error'));

    const result = await getHolidaysForYear(2025);
    expect(result.size).toBe(0);
  });

  it('DB find 拋出例外時回傳空 Map', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.find.mockImplementation(() => { throw new Error('DB error'); });
    getHolidaysCollection.mockReturnValue(col);

    const result = await getHolidaysForYear(2025);
    expect(result.size).toBe(0);
  });
});

// ── refreshHolidaysFromCDN ────────────────────────────────────────────────────

describe('refreshHolidaysFromCDN', () => {
  it('DB 未連線時提早返回，不呼叫 deleteMany', async () => {
    getIsDbConnected.mockReturnValue(false);
    await refreshHolidaysFromCDN();
    expect(getHolidaysCollection).not.toHaveBeenCalled();
  });

  it('DB 連線時刪除舊資料並重新抓取兩年資料', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.toArray.mockResolvedValue([]);
    getHolidaysCollection.mockReturnValue(col);
    global.fetch.mockResolvedValue({ ok: false });

    await refreshHolidaysFromCDN();

    expect(col.deleteMany).toHaveBeenCalledTimes(2);
    const currentYear = new Date().getFullYear();
    expect(col.deleteMany).toHaveBeenCalledWith({ _id: { $regex: `^${currentYear}` }, source: 'cdn' });
    expect(col.deleteMany).toHaveBeenCalledWith({ _id: { $regex: `^${currentYear + 1}` }, source: 'cdn' });
  });

  it('deleteMany 拋出例外時仍繼續執行（catch 吞掉錯誤）', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.deleteMany.mockRejectedValue(new Error('DB error'));
    getHolidaysCollection.mockReturnValue(col);

    await expect(refreshHolidaysFromCDN()).resolves.toBeUndefined();
  });

  it('重刷後快取已清除對應年份', async () => {
    getIsDbConnected.mockReturnValue(true);
    const currentYear = new Date().getFullYear();
    holidaysCache.set(currentYear, new Map());
    holidaysCache.set(currentYear + 1, new Map());

    const col = makeCol();
    col.toArray.mockResolvedValue([]);
    getHolidaysCollection.mockReturnValue(col);
    global.fetch.mockResolvedValue({ ok: false });

    await refreshHolidaysFromCDN();

    expect(holidaysCache.has(currentYear)).toBe(false);
    expect(holidaysCache.has(currentYear + 1)).toBe(false);
  });
});

// ── seedHolidays ─────────────────────────────────────────────────────────────

describe('seedHolidays', () => {
  it('DB 未連線時提早返回', async () => {
    getIsDbConnected.mockReturnValue(false);
    await seedHolidays();
    expect(getHolidaysCollection).not.toHaveBeenCalled();
  });

  it('DB 已有資料時跳過植入', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.countDocuments.mockResolvedValue(100);
    getHolidaysCollection.mockReturnValue(col);

    await seedHolidays();
    expect(col.insertMany).not.toHaveBeenCalled();
  });

  it('DB 空且無 JSON 檔案時不呼叫 insertMany', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.countDocuments.mockResolvedValue(0);
    getHolidaysCollection.mockReturnValue(col);
    fsMock.promises.readdir.mockResolvedValue([]);

    await seedHolidays();
    expect(col.insertMany).not.toHaveBeenCalled();
  });

  it('DB 空且有 JSON 資料時植入假日', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.countDocuments.mockResolvedValue(0);
    col.insertMany.mockResolvedValue({ insertedCount: 2 });
    getHolidaysCollection.mockReturnValue(col);

    fsMock.promises.readdir.mockResolvedValue(['2025.json']);
    fsMock.promises.readFile.mockResolvedValue(JSON.stringify([
      { date: '20250101', description: '元旦', isHoliday: true },
      { date: '20250102', description: '工作日', isHoliday: false },
    ]));

    await seedHolidays();
    expect(col.insertMany).toHaveBeenCalledTimes(1);
    const docs = col.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(1);
    expect(docs[0]._id).toBe('20250101');
  });

  it('holidays 目錄不存在時不 crash', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.countDocuments.mockResolvedValue(0);
    getHolidaysCollection.mockReturnValue(col);
    fsMock.promises.access.mockRejectedValue(new Error('ENOENT'));

    await expect(seedHolidays()).resolves.toBeUndefined();
    expect(col.insertMany).not.toHaveBeenCalled();
  });

  it('insertMany 拋出非 11000 錯誤時被外層 catch 捕獲，不 crash', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.countDocuments.mockResolvedValue(0);
    const nonDupError = Object.assign(new Error('network error'), { code: 500 });
    col.insertMany.mockRejectedValue(nonDupError);
    getHolidaysCollection.mockReturnValue(col);

    fsMock.promises.readdir.mockResolvedValue(['2025.json']);
    fsMock.promises.readFile.mockResolvedValue(JSON.stringify([
      { date: '20250101', description: '元旦', isHoliday: true },
    ]));

    await expect(seedHolidays()).resolves.toBeUndefined();
  });

  it('insertMany 因重複 key (11000) 不 crash', async () => {
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol();
    col.countDocuments.mockResolvedValue(0);
    const dupError = Object.assign(new Error('duplicate key'), { code: 11000, insertedCount: 1 });
    col.insertMany.mockRejectedValue(dupError);
    getHolidaysCollection.mockReturnValue(col);

    fsMock.promises.readdir.mockResolvedValue(['2025.json']);
    fsMock.promises.readFile.mockResolvedValue(JSON.stringify([
      { date: '20250101', description: '元旦', isHoliday: true },
    ]));

    await expect(seedHolidays()).resolves.toBeUndefined();
  });
});
