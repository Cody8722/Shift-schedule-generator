const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { CORS_ORIGIN } = require('./config');

// Routes
const statusRouter = require('./routes/status');
const holidaysRouter = require('./routes/holidays');
const profilesRouter = require('./routes/profiles');
const schedulesRouter = require('./routes/schedules');
const generateRouter = require('./routes/generate');
const schoolCalendarRouter = require('./routes/schoolCalendar');
const pdfPayloadRouter = require('./routes/pdfPayload');

const app = express();

// 信任代理設定 (必須在 rate limiter 之前設定)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",           // Tailwind 需要 inline script 注入 config
        'https://cdn.tailwindcss.com',
        'https://cdnjs.cloudflare.com',
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",           // Tailwind JIT 動態注入樣式
        'https://fonts.googleapis.com',
      ],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,  // CDN 資源不帶 COEP header，啟用會導致阻擋
}));

// helmet v8 不含 Permissions-Policy，手動加
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});

// API 回應加 no-store，避免快取敏感資料
app.use('/api/', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// CORS（CORS_ORIGIN 未設定時預設 * 僅適合開發環境，生產環境請設定 CORS_ORIGIN）
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
  skip: () => process.env.NODE_ENV !== 'production',
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: '來自此 IP 的請求過多，請於 15 分鐘後再試。',
  skip: () => process.env.NODE_ENV !== 'production',
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
app.use(pdfPayloadRouter);

// robots.txt（爬蟲不索引 API 路徑）
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /api/\n');
});

// Production：serve 前端 dist 靜態檔
const distPath = path.join(__dirname, '..', 'public');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // Dev fallback
  app.get('/', (req, res) => {
    res.send('<h1>智慧排班系統 v2 後端運行中</h1><p><a href="/api/status">API 狀態</a></p>');
  });
  app.get('/favicon.ico', (req, res) => res.status(204).end());
}

module.exports = app;
