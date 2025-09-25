// --- 模組引入 ---
const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient, ServerApiVersion } = require('mongodb');
const rateLimit = require('express-rate-limit');
const debug = require('debug');
require('dotenv').config();

// --- 除錯日誌設定 ---
const debugServer = debug('app:server');
const debugDb = debug('app:db');
const debugSchedule = debug('app:schedule');

// --- 常數設定 ---
const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'scheduleApp';
const PROFILES_COLLECTION = 'profiles';
const CONFIG_ID = 'main_config';

// --- 安全性：請求頻率限制 ---
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, 
	max: 100, 
	standardHeaders: true,
	legacyHeaders: false,
    message: { message: '請求過於頻繁，請稍後再試。' }
});

// --- MongoDB 客戶端設定 ---
const client = new MongoClient(MONGODB_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true, },
});

let db;

// --- 中介軟體 (Middleware) ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- API 路由 (Routes) ---
// FIX: Ensure API routes are defined before the static file server and wildcard route.
const apiRouter = express.Router();
apiRouter.use(limiter); // Apply rate limiting to all API routes
app.use('/api', apiRouter);

// --- 伺服器啟動與資料庫連線 ---
const startServer = async () => { /* ... content omitted for brevity ... */ };
startServer();

// --- 輔助函式 ---
const ensureConfigDocument = async () => { /* ... content omitted for brevity ... */ };
const sanitizeString = (str) => { /* ... content omitted for brevity ... */ };

// --- 所有 API 路由都改為註冊在 apiRouter 上 ---
apiRouter.get('/profiles', async (req, res) => { /* ... content omitted ... */ });
apiRouter.put('/profiles/active', async (req, res) => { /* ... content omitted ... */ });
apiRouter.post('/profiles', async (req, res) => { /* ... content omitted ... */ });
apiRouter.put('/profiles/:name', async (req, res) => { /* ... content omitted ... */ });
// ... other routes

// --- 排班演算法 (保持最終修正版) ---
const generateWeeklySchedule = (settings, scheduleDays) => { /* ... content omitted ... */ };
apiRouter.post('/generate-schedule', async (req, res) => { /* ... content omitted ... */ });


// --- 靜態檔案服務 & SPA Fallback ---
// This must be placed AFTER all API routes.
app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

