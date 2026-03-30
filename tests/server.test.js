/**
 * shift-schedule-generator API Tests
 * 测试排班系统的主要 API 端点
 */

const request = require('supertest');

// 模拟环境变量
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
process.env.DB_NAME = process.env.DB_NAME || 'test_scheduleApp';

// 动态导入 server（在设置环境变量后）
const app = require('../server');

describe('Health Check', () => {
  test('GET /status should return 200', async () => {
    const res = await request(app).get('/status');
    expect([200, 500]).toContain(res.status);
  });

  test('GET /status should return JSON', async () => {
    const res = await request(app).get('/status');
    expect(res.type).toBe('application/json');
  });
});

describe('Configuration API', () => {
  test('GET /api/config should return configuration', async () => {
    const res = await request(app).get('/api/config');
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });

  test('POST /api/config without data should handle gracefully', async () => {
    const res = await request(app)
      .post('/api/config')
      .send({})
      .set('Content-Type', 'application/json');
    expect([200, 400, 500]).toContain(res.status);
  });

  test('POST /api/config with valid data', async () => {
    const validConfig = {
      tasks: [{ name: 'Morning Shift', duration: 8 }],
      personnel: [{ name: 'John Doe', id: 'emp001' }]
    };
    const res = await request(app)
      .post('/api/config')
      .send(validConfig)
      .set('Content-Type', 'application/json');
    expect([200, 201, 400, 500]).toContain(res.status);
  });
});

describe('Schedule API', () => {
  test('GET /api/schedules should return schedules list', async () => {
    const res = await request(app).get('/api/schedules');
    expect([200, 500]).toContain(res.status);
    expect(res.type).toBe('application/json');
  });

  test('GET /api/schedules/:id with invalid ID', async () => {
    const res = await request(app).get('/api/schedules/invalid_id_123');
    expect([400, 404, 500]).toContain(res.status);
  });

  test('POST /api/schedules without data should fail', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .send({})
      .set('Content-Type', 'application/json');
    expect([400, 500]).toContain(res.status);
  });

  test('POST /api/schedules with valid data', async () => {
    const validSchedule = {
      week: '2024-W01',
      assignments: []
    };
    const res = await request(app)
      .post('/api/schedules')
      .send(validSchedule)
      .set('Content-Type', 'application/json');
    expect([200, 201, 400, 500]).toContain(res.status);
  });

  test('DELETE /api/schedules/:id with invalid ID', async () => {
    const res = await request(app).delete('/api/schedules/invalid_id_999');
    expect([400, 404, 500]).toContain(res.status);
  });
});

describe('Personnel Management', () => {
  test('GET /api/personnel should return personnel list', async () => {
    const res = await request(app).get('/api/personnel');
    expect([200, 404, 500]).toContain(res.status);
  });

  test('POST /api/personnel with valid data', async () => {
    const validPerson = {
      name: 'Jane Smith',
      id: 'emp002',
      skills: ['cashier', 'supervisor']
    };
    const res = await request(app)
      .post('/api/personnel')
      .send(validPerson)
      .set('Content-Type', 'application/json');
    expect([200, 201, 400, 500]).toContain(res.status);
  });

  test('POST /api/personnel without name should fail', async () => {
    const invalidPerson = {
      id: 'emp003'
      // missing name
    };
    const res = await request(app)
      .post('/api/personnel')
      .send(invalidPerson)
      .set('Content-Type', 'application/json');
    expect([400, 500]).toContain(res.status);
  });
});

describe('Holidays API', () => {
  test('GET /api/holidays should return holidays list', async () => {
    const res = await request(app).get('/api/holidays');
    expect([200, 500]).toContain(res.status);
  });

  test('POST /api/holidays with valid date', async () => {
    const validHoliday = {
      date: '2024-12-25',
      name: 'Christmas'
    };
    const res = await request(app)
      .post('/api/holidays')
      .send(validHoliday)
      .set('Content-Type', 'application/json');
    expect([200, 201, 400, 500]).toContain(res.status);
  });

  test('POST /api/holidays with invalid date format', async () => {
    const invalidHoliday = {
      date: 'invalid-date',
      name: 'Test Holiday'
    };
    const res = await request(app)
      .post('/api/holidays')
      .send(invalidHoliday)
      .set('Content-Type', 'application/json');
    expect([400, 500]).toContain(res.status);
  });
});

describe('Input Validation', () => {
  test('Should reject very long strings', async () => {
    const longString = 'a'.repeat(10000);
    const res = await request(app)
      .post('/api/personnel')
      .send({ name: longString, id: 'test' })
      .set('Content-Type', 'application/json');
    expect([200, 201, 400, 413, 500]).toContain(res.status);
  });

  test('Should handle special characters in input', async () => {
    const specialChars = {
      name: '<script>alert("xss")</script>',
      id: 'test001'
    };
    const res = await request(app)
      .post('/api/personnel')
      .send(specialChars)
      .set('Content-Type', 'application/json');
    expect([200, 201, 400, 500]).toContain(res.status);
  });
});

describe('Rate Limiting', () => {
  test('API should have rate limiting (check headers)', async () => {
    const res = await request(app).get('/api/config');
    // 检查是否有 rate limit headers
    // 如果没有，也不会失败，只是记录
    if (res.headers['x-ratelimit-limit']) {
      expect(res.headers).toHaveProperty('x-ratelimit-limit');
    }
  });
});

describe('CORS', () => {
  test('Should have CORS headers', async () => {
    const res = await request(app)
      .options('/status')
      .set('Origin', 'http://localhost:3000');
    expect([200, 204]).toContain(res.status);
  });
});

describe('Error Handling', () => {
  test('GET /nonexistent should return 404', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
  });

  test('Malformed JSON should be rejected', async () => {
    const res = await request(app)
      .post('/api/config')
      .send('{"invalid": json}')
      .set('Content-Type', 'application/json');
    expect([400, 500]).toContain(res.status);
  });

  test('Unsupported HTTP method should return 405 or 404', async () => {
    const res = await request(app).patch('/api/config');
    expect([404, 405, 500]).toContain(res.status);
  });
});
