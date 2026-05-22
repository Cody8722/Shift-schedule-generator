'use strict';

process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/db/connect', () => ({
  getIsDbConnected: jest.fn(),
  getSchoolEventsCollection: jest.fn(),
}));

jest.mock('iconv-lite', () => ({
  decode: jest.fn((buf) => buf.toString('utf8')),
}));

// ── 共用工具 ───────────────────────────────────────────────────────────────────

const { getIsDbConnected, getSchoolEventsCollection } = require('../../src/db/connect');

// 每個 describe 用 resetModules 取得乾淨的模組狀態（schoolEventsCache 是 module-level）
const loadModule = () => {
  jest.resetModules();
  jest.doMock('../../src/db/connect', () => ({
    getIsDbConnected,
    getSchoolEventsCollection,
  }));
  jest.doMock('iconv-lite', () => ({
    decode: jest.fn((buf) => buf.toString('utf8')),
  }));
  return require('../../src/services/schoolCalendar');
};

const makeArrayBuffer = (str) => Buffer.from(str).buffer;

const makeCol = (overrides = {}) => ({
  findOne: jest.fn().mockResolvedValue(null),
  replaceOne: jest.fn().mockResolvedValue({}),
  ...overrides,
});

// 空白 HTML（沒有任何符合條件的 <li>）
const EMPTY_HTML = '<html><body><ul></ul></body></html>';

// 有一筆高中部定期評量的 HTML（03/25 單日）
const EXAM_HTML = `<html><body><ul>
<li>
  <span class="blueWord1 eCLdateFS">03/25</span>
  <span class="eSpecABC W14">重要考試</span>
  <span class="GrayWord1 W14">高中部第一次定期評量</span>
</li>
</ul></body></html>`;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

// ── 記憶體快取命中 ─────────────────────────────────────────────────────────────

describe('getSchoolEvents — 記憶體快取命中', () => {
  it('快取有效時直接回傳，不查 DB 不呼叫 fetch', async () => {
    const mod = loadModule();
    const cachedData = [{ startDate: '20250325', endDate: '20250325', name: '一段', type: 'exam' }];
    mod.schoolEventsCache.data = cachedData;
    mod.schoolEventsCache.fetchedAt = Date.now();

    const result = await mod.getSchoolEvents();

    expect(result.cached).toBe(true);
    expect(result.data).toBe(cachedData);
    expect(getIsDbConnected).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('快取過期（> 6h）時重新抓取', async () => {
    const mod = loadModule();
    mod.schoolEventsCache.data = [{ name: '舊資料' }];
    mod.schoolEventsCache.fetchedAt = Date.now() - 7 * 60 * 60 * 1000; // 7 小時前

    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(EMPTY_HTML)),
    });

    const result = await mod.getSchoolEvents();
    expect(result.cached).toBe(false);
  });
});

// ── MongoDB 快取命中 ───────────────────────────────────────────────────────────

describe('getSchoolEvents — MongoDB 快取命中', () => {
  it('DB 快取有效時直接回傳，不呼叫 fetch', async () => {
    const mod = loadModule();
    const events = [{ startDate: '20250325', endDate: '20250326', name: '一段', type: 'exam' }];
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol({
      findOne: jest.fn().mockResolvedValue({
        _id: '1142',
        events,
        fetchedAt: Date.now() - 1000,
      }),
    });
    getSchoolEventsCollection.mockReturnValue(col);

    const result = await mod.getSchoolEvents();

    expect(result.cached).toBe(true);
    expect(result.data).toEqual(events);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('MongoDB 快取過期（> 7 天）時重新抓取', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol({
      findOne: jest.fn().mockResolvedValue({
        _id: '1142',
        events: [],
        fetchedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 天前
      }),
    });
    getSchoolEventsCollection.mockReturnValue(col);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(EMPTY_HTML)),
    });

    const result = await mod.getSchoolEvents();
    expect(result.cached).toBe(false);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('MongoDB findOne 拋出例外時繼續 fetch', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol({
      findOne: jest.fn().mockRejectedValue(new Error('Mongo error')),
    });
    getSchoolEventsCollection.mockReturnValue(col);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(EMPTY_HTML)),
    });

    const result = await mod.getSchoolEvents();
    expect(result.cached).toBe(false);
  });
});

// ── 無 DB，fetch 失敗 ──────────────────────────────────────────────────────────

describe('getSchoolEvents — 無 DB，fetch 失敗', () => {
  it('所有月份 fetch 失敗時回傳空陣列', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockRejectedValue(new Error('network error'));

    const result = await mod.getSchoolEvents();
    expect(result.cached).toBe(false);
    expect(result.data).toEqual([]);
  });
});

// ── 無 DB，fetch 成功（空 HTML）────────────────────────────────────────────────

describe('getSchoolEvents — 無 DB，fetch 成功空 HTML', () => {
  it('HTML 無符合條件的 li 時回傳空陣列', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(EMPTY_HTML)),
    });

    const result = await mod.getSchoolEvents();
    expect(result.cached).toBe(false);
    expect(result.data).toEqual([]);
  });
});

// ── 無 DB，fetch 成功（含考試 HTML）──────────────────────────────────────────

describe('getSchoolEvents — 無 DB，解析考試資料', () => {
  it('解析到高中部定期評量並合併為 event', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(EXAM_HTML)),
    });

    const result = await mod.getSchoolEvents();
    expect(result.cached).toBe(false);
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    const ev = result.data[0];
    expect(ev).toHaveProperty('startDate');
    expect(ev).toHaveProperty('endDate');
    expect(ev).toHaveProperty('type', 'exam');
  });
});

// ── isHighSchoolExam 與 getCleanExamName 各分支 ──────────────────────────────

describe('getSchoolEvents — 考試名稱分支覆蓋', () => {
  const makeHtml = (date, name) => `<html><body><ul>
<li>
  <span class="blueWord1 eCLdateFS">${date}</span>
  <span class="eSpecABC W14">重要考試</span>
  <span class="GrayWord1 W14">${name}</span>
</li>
</ul></body></html>`;

  it('技高（L47）觸發 isHighSchoolExam → 加入事件', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(makeHtml('03/25', '技高第一次定期評量'))),
    });
    const result = await mod.getSchoolEvents();
    expect(result.data.length).toBeGreaterThanOrEqual(1);
  });

  it('高一（L48）觸發 isHighSchoolExam → 加入事件', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(makeHtml('03/25', '高一第一次定期評量'))),
    });
    const result = await mod.getSchoolEvents();
    expect(result.data.length).toBeGreaterThanOrEqual(1);
  });

  it('非高中部（L49 return false）→ 事件被過濾，回傳空陣列', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(makeHtml('03/25', '國中部第一次定期評量'))),
    });
    const result = await mod.getSchoolEvents();
    expect(result.data).toEqual([]);
  });

  it('名稱含「第二次」→ getCleanExamName 回傳「二段」（L61）', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(makeHtml('04/10', '高中部第二次定期評量'))),
    });
    const result = await mod.getSchoolEvents();
    expect(result.data.some((e) => e.name.includes('二段') || e.name.includes('第二次二段'))).toBe(true);
  });

  it('名稱含「第三次」→ getCleanExamName 回傳「三段」（L62）', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(makeHtml('04/10', '高中部第三次定期評量'))),
    });
    const result = await mod.getSchoolEvents();
    expect(result.data.some((e) => e.name.includes('三段') || e.name.includes('第三次三段'))).toBe(true);
  });

  it('名稱含「第四次」→ getCleanExamName 回傳「四段」（L63）', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(makeHtml('04/10', '高中部第四次定期評量'))),
    });
    const result = await mod.getSchoolEvents();
    expect(result.data.some((e) => e.name.includes('四段') || e.name.includes('第四次四段'))).toBe(true);
  });

  it('名稱含「期中」→ getCleanExamName 回傳「期中考」（L64）', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(makeHtml('04/10', '高中部期中考'))),
    });
    const result = await mod.getSchoolEvents();
    expect(result.data.some((e) => e.name.includes('期中考'))).toBe(true);
  });

  it('名稱無特殊詞 → getCleanExamName 回傳「定期評量」（L65）', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(makeHtml('04/10', '高中部定期評量'))),
    });
    const result = await mod.getSchoolEvents();
    expect(result.data.some((e) => e.name.includes('定期評量'))).toBe(true);
  });
});

// ── 連續日期合併與重名編號 ──────────────────────────────────────────────────────

describe('getSchoolEvents — 連續日期合併與重名編號', () => {
  // 3 筆考試：03/25、03/26（連續）、03/28（不連續）且同名
  const MULTI_EXAM_HTML = `<html><body><ul>
<li>
  <span class="blueWord1 eCLdateFS">03/25</span>
  <span class="eSpecABC W14">重要考試</span>
  <span class="GrayWord1 W14">高中部定期評量</span>
</li>
<li>
  <span class="blueWord1 eCLdateFS">03/26</span>
  <span class="eSpecABC W14">重要考試</span>
  <span class="GrayWord1 W14">高中部定期評量</span>
</li>
<li>
  <span class="blueWord1 eCLdateFS">03/28</span>
  <span class="eSpecABC W14">重要考試</span>
  <span class="GrayWord1 W14">高中部定期評量</span>
</li>
</ul></body></html>`;

  it('連續日期（03/25-26）合併成一個 event（L193-194）', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(MULTI_EXAM_HTML)),
    });
    const result = await mod.getSchoolEvents();
    // 3 個日期 → 2 個 event（03/25-26 合併，03/28 單獨）
    expect(result.data.length).toBe(2);
    const merged = result.data.find((e) => e.startDate !== e.endDate);
    expect(merged).toBeDefined();
  });

  it('不連續日期觸發 range 切分（L195-197）並開新 range', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(MULTI_EXAM_HTML)),
    });
    const result = await mod.getSchoolEvents();
    // 第二個 event 的 startDate === endDate（單日）
    const single = result.data.find((e) => e.startDate === e.endDate);
    expect(single).toBeDefined();
  });

  it('同名 event 依序編號（L211-212）', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(MULTI_EXAM_HTML)),
    });
    const result = await mod.getSchoolEvents();
    // 兩個「定期評量」應被重新命名為「第一次定期評量」與「第二次定期評量」
    const names = result.data.map((e) => e.name);
    expect(names.some((n) => n.includes('第一次'))).toBe(true);
    expect(names.some((n) => n.includes('第二次'))).toBe(true);
  });
});

// ── 有 DB，fetch 後存入 MongoDB 快取 ──────────────────────────────────────────

describe('getSchoolEvents — 有 DB，寫入 MongoDB 快取', () => {
  it('fetch 完成後呼叫 replaceOne 存快取', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol({
      findOne: jest.fn().mockResolvedValue(null), // 無快取
    });
    getSchoolEventsCollection.mockReturnValue(col);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(EMPTY_HTML)),
    });

    await mod.getSchoolEvents();
    expect(col.replaceOne).toHaveBeenCalled();
  });

  it('replaceOne 失敗時不 crash，仍回傳資料', async () => {
    const mod = loadModule();
    getIsDbConnected.mockReturnValue(true);
    const col = makeCol({
      findOne: jest.fn().mockResolvedValue(null),
      replaceOne: jest.fn().mockRejectedValue(new Error('write failed')),
    });
    getSchoolEventsCollection.mockReturnValue(col);
    global.fetch.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer(EMPTY_HTML)),
    });

    const result = await mod.getSchoolEvents();
    expect(result).toHaveProperty('data');
  });
});
