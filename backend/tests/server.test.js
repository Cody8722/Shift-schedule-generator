'use strict';

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server');

// ─── 測試資料 ──────────────────────────────────────────────────────────────

const minimalSettings = {
  tasks: [{ name: '早班', count: 1 }],
  personnel: [
    { name: '張三', maxShifts: 5 },
    { name: '李四', maxShifts: 5 },
  ],
};

const validBody = {
  settings: minimalSettings,
  startWeek: '2025-W01',
  numWeeks: 1,
};

// ─── 整合測試：API 端點 ───────────────────────────────────────────────────

describe('GET /api/status', () => {
  it('回傳 server: running', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.server).toBe('running');
    expect(res.body).toHaveProperty('database');
  });
});

describe('POST /api/generate-schedule', () => {
  it('成功產生一週班表，回傳 data 陣列與 html 字串', async () => {
    const res = await request(app).post('/api/generate-schedule').send(validBody);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(typeof res.body.html).toBe('string');
  });

  it('回傳的 data 包含正確的結構欄位', async () => {
    const res = await request(app).post('/api/generate-schedule').send(validBody);
    const week = res.body.data[0];
    expect(week).toHaveProperty('schedule');
    expect(week).toHaveProperty('fillStats');
    expect(week).toHaveProperty('tasks');
    expect(week).toHaveProperty('dateRange');
    expect(week).toHaveProperty('scheduleDays');
  });

  it('fillStats 結構正確', async () => {
    const res = await request(app).post('/api/generate-schedule').send(validBody);
    const [stat] = res.body.data[0].fillStats;
    expect(stat).toHaveProperty('name');
    expect(stat).toHaveProperty('priority');
    expect(stat).toHaveProperty('needed');
    expect(stat).toHaveProperty('filled');
    expect(stat).toHaveProperty('ok');
  });

  it('多週班表回傳正確筆數', async () => {
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, numWeeks: 3 });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });

  // numWeeks 邊界條件
  it('numWeeks=52 是最大合法值', async () => {
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, numWeeks: 52 });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(52);
  });

  it('numWeeks=0 回傳 400', async () => {
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, numWeeks: 0 });
    expect(res.status).toBe(400);
  });

  it('numWeeks=-1 回傳 400', async () => {
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, numWeeks: -1 });
    expect(res.status).toBe(400);
  });

  it('numWeeks=1.5 (非整數) 回傳 400', async () => {
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, numWeeks: 1.5 });
    expect(res.status).toBe(400);
  });

  it('numWeeks=53 超出上限回傳 400', async () => {
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, numWeeks: 53 });
    expect(res.status).toBe(400);
  });

  // offDays 邊界條件
  it('offDays 含非法值 5 回傳 400', async () => {
    const settings = {
      ...minimalSettings,
      personnel: [{ name: '張三', maxShifts: 5, offDays: [5] }],
    };
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, settings });
    expect(res.status).toBe(400);
  });

  it('offDays 含負數回傳 400', async () => {
    const settings = {
      ...minimalSettings,
      personnel: [{ name: '張三', maxShifts: 5, offDays: [-1] }],
    };
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, settings });
    expect(res.status).toBe(400);
  });

  it('缺少 settings 回傳 400', async () => {
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ startWeek: '2025-W01', numWeeks: 1 });
    expect(res.status).toBe(400);
  });

  it('startWeek 格式錯誤回傳 400', async () => {
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, startWeek: '2025/01/06' });
    expect(res.status).toBe(400);
  });

  it('activeHolidays 非陣列回傳 400', async () => {
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, activeHolidays: '20250101' });
    expect(res.status).toBe(400);
  });

  it('activeHolidays 含非字串元素回傳 400', async () => {
    const res = await request(app)
      .post('/api/generate-schedule')
      .send({ ...validBody, activeHolidays: [20250101] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/render-schedule', () => {
  it('傳入有效班表資料回傳 html', async () => {
    const genRes = await request(app).post('/api/generate-schedule').send(validBody);
    const fullScheduleData = genRes.body.data;

    const res = await request(app).post('/api/render-schedule').send(fullScheduleData);
    expect(res.status).toBe(200);
    expect(typeof res.body.html).toBe('string');
    expect(res.body.html.length).toBeGreaterThan(0);
  });

  it('傳入非陣列資料回傳 400', async () => {
    const res = await request(app).post('/api/render-schedule').send({ invalid: true });
    expect(res.status).toBe(400);
  });
});

describe('Profiles API', () => {
  it('GET /api/profiles 在無資料庫時仍回傳 200（空陣列或 disconnected 回應）', async () => {
    const res = await request(app).get('/api/profiles');
    // 無 DB 時可能回 503/200，皆可接受；確保不 crash
    expect([200, 503]).toContain(res.status);
  });
});

describe('未知路由', () => {
  it('回傳 404', async () => {
    const res = await request(app).get('/api/this-does-not-exist');
    expect(res.status).toBe(404);
  });
});
