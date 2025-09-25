// --- 模组引入 ---
const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient, ServerApiVersion } = require('mongodb');
const rateLimit = require('express-rate-limit');
const debug = require('debug');
require('dotenv').config();

// --- 除错日誌设定 ---
const debugServer = debug('app:server');
const debugDb = debug('app:db');
const debugSchedule = debug('app:schedule');

// --- 常数设定 ---
const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'scheduleApp';
const PROFILES_COLLECTION = 'profiles';
const CONFIG_ID = 'main_config';

// --- 安全性：请求频率限制 ---
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, 
	max: 100, 
	standardHeaders: true,
	legacyHeaders: false,
    message: { message: '请求过於频繁，请稍後再试。' }
});

// --- MongoDB 客戶端設定 ---
const client = new MongoClient(MONGODB_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true, },
});

let db;

// --- 中介軟體 (Middleware) ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- FIX: 信任 Zeabur 的代理伺服器 ---
// This setting is crucial for rate limiting to work correctly behind a proxy like Zeabur.
app.set('trust proxy', 1);

// --- API 路由 (Routes) ---
const apiRouter = express.Router();
apiRouter.use(limiter); // Apply rate limiting to all API routes
app.use('/api', apiRouter);


// 辅导函式... (省略)
const ensureConfigDocument = async () => { /* ... */ };
const sanitizeString = (str) => { /* ... */ };
const getWeekInfo = (weekString, weekIndex) => { /* ... */ };
const getHolidaysForYear = async (year) => { /* ... */ };
const generateWeeklySchedule = (settings, scheduleDays) => { /* ... */ };

// --- API 路由实作 ---
apiRouter.get('/profiles', async (req, res) => { /* ... */ });
apiRouter.put('/profiles/active', async (req, res) => { /* ... */ });
apiRouter.post('/profiles', async (req, res) => { /* ... */ });
apiRouter.put('/profiles/:name', async (req, res) => { /* ... */ });
apiRouter.put('/profiles/:name/rename', async (req, res) => { /* ... */ });
apiRouter.delete('/profiles/:name', async (req, res) => { /* ... */ });
apiRouter.get('/schedules/:name', async (req, res) => { /* ... */ });
apiRouter.post('/schedules', async (req, res) => { /* ... */ });
apiRouter.delete('/schedules/:name', async (req, res) => { /* ... */ });
apiRouter.get('/holidays/:year', async (req, res) => { /* ... */ });
apiRouter.post('/generate-schedule', async (req, res) => {
    debugServer(`收到请求: POST ${req.originalUrl}`);
    const { settings, startWeek, numWeeks } = req.body;
    const colorSchemes = [
        { header: '#cc4125' }, { header: '#e06666' },
        { header: '#f6b26b' }, { header: '#ffd966' },
        { header: '#93c47d' }, { header: '#76a5af' },
        { header: '#6d9eeb' }, { header: '#6fa8dc' },
        { header: '#8e7cc3' }, { header: '#c27ba0' }
    ];

    if (!settings || !startWeek || !numWeeks) {
        return res.status(400).json({ message: '缺少必要的排班参数' });
    }
    
    const totalRequiredShifts = 5 * (settings.tasks || []).reduce((sum, task) => sum + (task.count || 0), 0);
    const totalAvailableShifts = (settings.personnel || []).reduce((sum, p) => sum + (p.maxShifts || 0), 0);
    if(totalRequiredShifts > totalAvailableShifts){
        debugSchedule(`排班失败：需求班次 (${totalRequiredShifts}) > 可用班次 (${totalAvailableShifts})`);
        return res.status(400).json({ message: `排班失败：总需求班次 (${totalRequiredShifts}) 超过总可用班次 (${totalAvailableShifts})。请增加人力或减少勤務需求。` });
    }

    try {
        let generatedData = [];
        for (let i = 0; i < numWeeks; i++) {
            const { year, weekDates, weekDayDates } = getWeekInfo(startWeek, i);
            const holidays = await getHolidaysForYear(year);

            const scheduleDays = weekDates.slice(0, 5).map(dateStr => {
                if (holidays.has(dateStr)) {
                    return { shouldSchedule: false, description: '国定假日' };
                }
                return { shouldSchedule: true };
            });
            
            const schedule = generateWeeklySchedule(settings, scheduleDays);
            const startDate = weekDayDates[0];
            const endDate = weekDayDates[weekDayDates.length-1];

            generatedData.push({
                schedule,
                tasks: settings.tasks,
                dateRange: `${startDate} - ${endDate}`,
                weekDayDates,
                scheduleDays,
                color: colorSchemes[i % colorSchemes.length]
            });
        }
        res.json(generatedData);
    } catch (e) {
        debugServer(`POST /api/generate-schedule 错误: %O`, e);
        res.status(500).json({ message: '产生班表时发生内部错误', error: e.message });
    }
});


// --- 靜態檔案服務 & SPA Fallback ---
app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


// --- 伺服器啟動 ---
const startServer = async () => {
    try {
        debugServer('正在连线至 MongoDB...');
        await client.connect();
        debugDb('已成功连线到 MongoDB Atlas!');
        db = client.db(DB_NAME);
        
        client.on('close', () => debugDb('MongoDB 连线已中断'));
        client.on('reconnect', () => debugDb('已成功重新连线到 MongoDB'));

        await ensureConfigDocument();
        
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上运行`);
        });
    } catch (err) {
        console.error("无法连线到 MongoDB 或启动伺服器:", err);
        debugServer('伺服器启动失败: %O', err);
        process.exit(1);
    }
};

startServer();

