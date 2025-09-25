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

// --- API 路由 (Routes) ---
// FIX: 將所有 API 路由都放在一個地方，並加上頻率限制
const apiRouter = express.Router();
app.use('/api', limiter, apiRouter);


// 輔助函式
const ensureConfigDocument = async () => {
    const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
    if (!config) {
        debugDb("找不到設定檔文件，正在建立新的...");
        await db.collection(PROFILES_COLLECTION).insertOne({
            _id: CONFIG_ID, activeProfile: 'default',
            profiles: { 'default': { settings: { tasks: [], personnel: [] }, schedules: {} } }
        });
    }
};

const sanitizeString = (str) => {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>&"']/g, '');
};

// --- 所有 API 路由都改為註冊在 apiRouter 上 ---
apiRouter.get('/profiles', async (req, res) => {
    debugServer(`收到請求: GET ${req.originalUrl}`);
    try {
        const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
        res.json(config);
    } catch (e) { 
        debugServer(`GET /api/profiles 錯誤: %O`, e);
        res.status(500).json({ message: '讀取設定檔時發生錯誤', error: e.message });
    }
});

apiRouter.put('/profiles/active', async (req, res) => {
    debugServer(`收到請求: PUT ${req.originalUrl}`);
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ message: '設定檔名稱格式錯誤' });
    try {
        await db.collection(PROFILES_COLLECTION).updateOne({ _id: CONFIG_ID }, { $set: { activeProfile: sanitizeString(name) } });
        res.json({ message: `已切換至設定檔 ${name}` });
    } catch (e) { 
        debugServer(`PUT /api/profiles/active 錯誤: %O`, e);
        res.status(500).json({ message: '切換設定檔失敗', error: e.message });
     }
});

apiRouter.post('/profiles', async (req, res) => {
    debugServer(`收到請求: POST ${req.originalUrl}`);
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') return res.status(400).json({ message: '設定檔名稱不可為空' });
    const sanitizedName = sanitizeString(name.trim());
    try {
        const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
        if(config.profiles[sanitizedName]) {
            return res.status(409).json({ message: '設定檔名稱已存在' });
        }
        const newProfile = { settings: { tasks: [], personnel: [] }, schedules: {} };
        await db.collection(PROFILES_COLLECTION).updateOne({ _id: CONFIG_ID }, { $set: { [`profiles.${sanitizedName}`]: newProfile } });
        res.status(201).json({ message: `已新增設定檔 ${sanitizedName}` });
    } catch (e) { 
        debugServer(`POST /api/profiles 錯誤: %O`, e);
        res.status(500).json({ message: '新增設定檔失敗', error: e.message });
    }
});

apiRouter.put('/profiles/:name', async (req, res) => {
    debugServer(`收到請求: PUT ${req.originalUrl}`);
    const name = sanitizeString(req.params.name);
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object' || !Array.isArray(settings.tasks) || !Array.isArray(settings.personnel)) {
        return res.status(400).json({ message: '設定資料格式錯誤' });
    }
    try {
        const sanitizedSettings = {
            tasks: settings.tasks.map(t => ({ name: sanitizeString(t.name), count: Math.max(1, parseInt(t.count, 10) || 1) })),
            personnel: settings.personnel.map(p => ({ 
                name: sanitizeString(p.name), 
                maxShifts: Math.max(1, parseInt(p.maxShifts, 10) || 5),
                offDays: p.offDays || [],
                preferredTask: sanitizeString(p.preferredTask) || ''
            }))
        };
        await db.collection(PROFILES_COLLECTION).updateOne({ _id: CONFIG_ID }, { $set: { [`profiles.${name}.settings`]: sanitizedSettings } });
        res.json({ message: `設定檔 ${name} 已更新` });
    } catch (e) { 
        debugServer(`PUT /api/profiles/:name 錯誤: %O`, e);
        res.status(500).json({ message: '更新設定檔失敗', error: e.message });
     }
});

apiRouter.put('/profiles/:name/rename', async (req, res) => { /* ... */ });
apiRouter.delete('/profiles/:name', async (req, res) => { /* ... */ });
apiRouter.get('/schedules/:name', async (req, res) => { /* ... */ });
apiRouter.post('/schedules', async (req, res) => { /* ... */ });
apiRouter.delete('/schedules/:name', async (req, res) => { /* ... */ });
apiRouter.get('/holidays/:year', async (req, res) => { /* ... */ });

// 排班演算法
const generateWeeklySchedule = (settings, scheduleDays) => { /* ... */ };

const getWeekInfo = (weekString, weekIndex) => { /* ... */ };
const getHolidaysForYear = async (year) => { /* ... */ };


apiRouter.post('/generate-schedule', async (req, res) => {
    debugServer(`收到請求: POST ${req.originalUrl}`);
    const { settings, startWeek, numWeeks } = req.body;
    const colorSchemes = [
        { header: '#cc4125' }, { header: '#e06666' },
        { header: '#f6b26b' }, { header: '#ffd966' },
        { header: '#93c47d' }, { header: '#76a5af' },
        { header: '#6d9eeb' }, { header: '#6fa8dc' },
        { header: '#8e7cc3' }, { header: '#c27ba0' }
    ];

    if (!settings || !startWeek || !numWeeks) {
        return res.status(400).json({ message: '缺少必要的排班參數' });
    }
    
    const totalRequiredShifts = 5 * (settings.tasks || []).reduce((sum, task) => sum + (task.count || 0), 0);
    const totalAvailableShifts = (settings.personnel || []).reduce((sum, p) => sum + (p.maxShifts || 0), 0);
    if(totalRequiredShifts > totalAvailableShifts){
        debugSchedule(`排班失敗：需求班次 (${totalRequiredShifts}) > 可用班次 (${totalAvailableShifts})`);
        return res.status(400).json({ message: `排班失敗：總需求班次 (${totalRequiredShifts}) 超過總可用班次 (${totalAvailableShifts})。請增加人力或減少勤務需求。` });
    }

    try {
        let generatedData = [];
        for (let i = 0; i < numWeeks; i++) {
            const { year, weekDates, weekDayDates } = getWeekInfo(startWeek, i);
            const holidays = await getHolidaysForYear(year);

            const scheduleDays = weekDates.slice(0, 5).map(dateStr => {
                if (holidays.has(dateStr)) {
                    return { shouldSchedule: false, description: '國定假日' };
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
        debugServer(`POST /api/generate-schedule 錯誤: %O`, e);
        res.status(500).json({ message: '產生班表時發生內部錯誤', error: e.message });
    }
});


// --- 靜態檔案服務 & SPA Fallback ---
// 這兩項必須放在所有 API 路由之後
app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


// --- 伺服器啟動 ---
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
        console.error("無法連線到 MongoDB 或啟動伺-服器:", err);
        debugServer('伺服器啟動失敗: %O', err);
        process.exit(1);
    }
};

startServer();

