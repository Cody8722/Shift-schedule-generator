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
let isDbConnected = false;

// --- 中介軟體 (Middleware) ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.set('trust proxy', 1);

// --- API 路由 (Routes) ---
const apiRouter = express.Router();
apiRouter.use(limiter);
app.use('/api', apiRouter);

// --- 輔助函式 (省略) ---
// ...

// --- API 路由實作 ---

// 新增：狀態檢查端點
apiRouter.get('/status', async (req, res) => {
    // isDbConnected flag is updated by the connection logic
    if (isDbConnected) {
        res.status(200).json({ status: 'ok', database: 'connected' });
    } else {
        res.status(200).json({ status: 'ok', database: 'disconnected' });
    }
});

// ... 其他路由 ...
apiRouter.post('/generate-schedule', async (req, res) => { /* ... */ });


// --- 靜態檔案服務 & SPA Fallback ---
app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


// --- 伺服器啟動與資料庫連線 ---
const startServer = async () => {
    try {
        debugServer('正在連線至 MongoDB...');
        await client.connect();
        db = client.db(DB_NAME);
        
        // 持續監控資料庫連線狀態
        client.on('topologyDescriptionChanged', event => {
            const newStatus = event.newDescription.hasReadableServer();
            if (isDbConnected !== newStatus) {
                isDbConnected = newStatus;
                debugDb(`MongoDB 連線狀態改變: ${isDbConnected ? '已連線' : '已中斷'}`);
            }
        });
        
        // 初始檢查
        isDbConnected = (await db.admin().ping()).ok === 1;
        debugDb(`初始 MongoDB 連線狀態: ${isDbConnected ? '已連線' : '已中斷'}`);

        await ensureConfigDocument();
        
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上運行`);
        });
    } catch (err) {
        console.error("無法連線到 MongoDB 或啟動伺服器:", err);
        isDbConnected = false;
        debugServer('伺服器啟動失敗: %O', err);
        // 即使資料庫連線失敗，伺服器還是要啟動，只是狀態會是 error
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上運行 (資料庫連線失敗)`);
        });
    }
};

startServer();

