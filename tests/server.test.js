/**
 * 排班系統 API 測試
 * 不需要 MongoDB 連線（server 在無 DB 模式下仍可運行）
 */

const request = require('supertest');
process.env.NODE_ENV = 'test';
const app = require('../server');

const validSettings = {
    settings: {
        tasks: [{ name: '早班', count: 1 }],
        personnel: [
            { name: '小明', maxShifts: 5, offDays: [], preferredTask: '早班' },
            { name: '小華', maxShifts: 5, offDays: [], preferredTask: '' }
        ]
    },
    startWeek: '2026-W14',
    numWeeks: 1,
    activeHolidays: []
};

describe('Health Check', () => {
    test('GET /api/status 回傳 200', async () => {
        const res = await request(app).get('/api/status');
        expect(res.status).toBe(200);
        expect(res.type).toBe('application/json');
    });
});

describe('排班產生 API', () => {
    test('合法設定產生班表成功', async () => {
        const res = await request(app)
            .post('/api/generate-schedule')
            .send(validSettings);
        expect(res.status).toBe(200);
        expect(res.body.data).toBeDefined();
        expect(res.body.html).toBeDefined();
    });

    test('缺少 tasks → 400', async () => {
        const res = await request(app)
            .post('/api/generate-schedule')
            .send({ settings: { personnel: [] }, startWeek: '2026-W14', numWeeks: 1 });
        expect(res.status).toBe(400);
    });

    test('缺少 personnel → 400', async () => {
        const res = await request(app)
            .post('/api/generate-schedule')
            .send({ settings: { tasks: [] }, startWeek: '2026-W14', numWeeks: 1 });
        expect(res.status).toBe(400);
    });

    test('taskScores 非法值（超出 0-5）→ 400', async () => {
        const bad = JSON.parse(JSON.stringify(validSettings));
        bad.settings.personnel[0].taskScores = { '早班': 9 };
        const res = await request(app)
            .post('/api/generate-schedule')
            .send(bad);
        expect(res.status).toBe(400);
    });

    test('taskScores 合法值正常通過', async () => {
        const good = JSON.parse(JSON.stringify(validSettings));
        good.settings.personnel[0].taskScores = { '早班': 5 };
        const res = await request(app)
            .post('/api/generate-schedule')
            .send(good);
        expect(res.status).toBe(200);
    });
});

describe('Profiles API', () => {
    test('GET /api/profiles 回傳 200 或 503', async () => {
        const res = await request(app).get('/api/profiles');
        expect([200, 503]).toContain(res.status);
    });
});

describe('錯誤處理', () => {
    test('不存在路由 → 404', async () => {
        const res = await request(app).get('/api/nonexistent');
        expect(res.status).toBe(404);
    });
});
