const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { CORS_ORIGIN } = require('./config');

// Routes
const statusRouter = require('./routes/status');
const holidaysRouter = require('./routes/holidays');
const profilesRouter = require('./routes/profiles');
const schedulesRouter = require('./routes/schedules');
const generateRouter = require('./routes/generate');
const schoolCalendarRouter = require('./routes/schoolCalendar');

const app = express();

// 信任代理設定 (必須在 rate limiter 之前設定)
app.set('trust proxy', 1);

// CORS
const corsOptions = {
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type'],
};
app.use(cors(corsOptions));
app.use(express.json());

// 速率限制（分層）
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: '來自此 IP 的請求過多，請於 15 分鐘後再試。',
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: '來自此 IP 的請求過多，請於 15 分鐘後再試。',
});

// 依 HTTP 方法套用速率限制
app.use('/api/', (req, res, next) => {
  if (req.method === 'GET') return readLimiter(req, res, next);
  return writeLimiter(req, res, next);
});

// 掛載路由
app.use(statusRouter);
app.use(holidaysRouter);
app.use(profilesRouter);
app.use(schedulesRouter);
app.use(generateRouter);
app.use(schoolCalendarRouter);

// 根路由 placeholder（前端 Vite dev server 會接管，此處只提供 fallback）
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><title>智慧排班系統 v2</title></head>
<body>
  <h1>智慧排班系統 v2 後端運行中</h1>
  <p>請啟動前端 Vite dev server (v2/frontend) 以使用完整功能。</p>
  <p><a href="/api/status">查看 API 狀態</a></p>
</body>
</html>`);
});

// Favicon 路由 - 防止 404
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

module.exports = app;
