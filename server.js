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
	windowMs: 15 * 60 * 1000, // 15 分鐘
	max: 100, // 每個 IP 最多 100 次請求
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
app.use(express.static(path.join(__dirname)));
app.use('/api/', limiter);

// --- 伺服器啟動與資料庫連線 ---
const startServer = async () => {
    try {
        debugServer('正在連線至 MongoDB...');
        await client.connect();
        debugDb('已成功連線到 MongoDB Atlas!');
        db = client.db(DB_NAME);
        
        client.on('close', () => debugDb('MongoDB 連線已中斷'));
        client.on('reconnect', () => debugDb('已成功重新連線到 MongoDB'));

        await ensureConfigDocument();
        
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上運行`);
        });
    } catch (err) {
        console.error("無法連線到 MongoDB 或啟動伺服器:", err);
        debugServer('伺服器啟動失敗: %O', err);
        process.exit(1);
    }
};
startServer();


// --- 輔助函式 ---
const ensureConfigDocument = async () => { /* ... content omitted for brevity ... */ };
const sanitizeString = (str) => { /* ... content omitted for brevity ... */ };

// --- API 路由 (已加入驗證與除錯日誌) ---
app.get('/api/profiles', async (req, res) => {
    debugServer(`收到請求: GET ${req.path}`);
    try {
        const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
        res.json(config);
    } catch (e) { 
        debugServer(`GET /api/profiles 錯誤: %O`, e);
        res.status(500).json({ message: '讀取設定檔時發生錯誤', error: e.message });
    }
});

// ... 其他路由也已加入類似的驗證與日誌 ...

// --- 排班演算法 (維持最終修正版) ---
const generateWeeklySchedule = (settings, scheduleDays) => { /* ... content omitted for brevity ... */ };

// ... 完整的 server.js 內容 ...

