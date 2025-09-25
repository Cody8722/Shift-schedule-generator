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
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100, 
	standardHeaders: true,
	legacyHeaders: false,
    message: { message: '請求過於頻繁，請稍後再試。' }
});
apiRouter.use(limiter);
app.use('/api', apiRouter);

// --- 輔助函式 ---
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

const getWeekInfo = (weekString, weekIndex) => {
    const [year, week] = weekString.split('-W').map(Number);
    const date = new Date(year, 0, 1 + (week - 1 + weekIndex) * 7);
    date.setDate(date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1));
    const weekDates = [], weekDayDates = [];
    for (let i = 0; i < 7; i++) {
        const currentDate = new Date(date);
        currentDate.setDate(date.getDate() + i);
        const yyyy = currentDate.getFullYear();
        const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
        const dd = String(currentDate.getDate()).padStart(2, '0');
        weekDates.push(`${yyyy}${mm}${dd}`);
        if (i < 5) weekDayDates.push(`${mm}/${dd}`);
    }
    return { year, weekDates, weekDayDates };
};

const holidaysCache = {};
const getHolidaysForYear = async (year) => {
    if (holidaysCache[year]) return holidaysCache[year];
    const filePath = path.join(__dirname, 'holidays', `${year}.json`);
    try {
        const data = await require('fs').promises.readFile(filePath, 'utf-8');
        const holidayData = JSON.parse(data);
        const holidaySet = new Set(holidayData.filter(h => h.isHoliday).map(h => h.date));
        holidaysCache[year] = holidaySet;
        return holidaySet;
    } catch (error) {
        debugServer(`找不到 ${year} 年的假日檔案:`, error.message);
        holidaysCache[year] = new Set();
        return holidaysCache[year];
    }
};

const generateWeeklySchedule = (settings, scheduleDays) => {
    const { personnel, tasks } = settings;
    const sanitizedPersonnel = personnel.map(p => ({ ...p, maxShifts: parseInt(p.maxShifts, 10) || 5 }));
    let schedule = Array.from({ length: 5 }, () => Array.from({ length: tasks.length }, () => []));
    let weeklyCounts = sanitizedPersonnel.map(() => 0);
    let personnelPool = sanitizedPersonnel.map((p, i) => ({ ...p, originalIndex: i }));
    const allShifts = [];
    for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
        if (!scheduleDays[dayIndex].shouldSchedule) continue;
        for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
            for (let slotIndex = 0; slotIndex < tasks[taskIndex].count; slotIndex++) {
                allShifts.push({ dayIndex, taskIndex });
            }
        }
    }
    allShifts.sort(() => Math.random() - 0.5);
    for (const shift of allShifts) {
        const { dayIndex, taskIndex } = shift;
        let availablePersonnel = personnelPool.filter(p => {
            const isAlreadyAssignedToday = schedule[dayIndex].flat().includes(p.name);
            const hasReachedWeeklyMax = weeklyCounts[p.originalIndex] >= p.maxShifts;
            const isOffDay = p.offDays.includes(dayIndex);
            return !isAlreadyAssignedToday && !hasReachedWeeklyMax && !isOffDay;
        });
        if (availablePersonnel.length === 0) continue;
        availablePersonnel.sort((a, b) => {
            const countA = weeklyCounts[a.originalIndex];
            const countB = weeklyCounts[b.originalIndex];
            if (countA !== countB) return countA - countB;
            const aIsPreferred = a.preferredTask === tasks[taskIndex].name;
            const bIsPreferred = b.preferredTask === tasks[taskIndex].name;
            if (aIsPreferred && !bIsPreferred) return -1;
            if (!aIsPreferred && bIsPreferred) return 1;
            return Math.random() - 0.5;
        });
        const personToAssign = availablePersonnel[0];
        schedule[dayIndex][taskIndex].push(personToAssign.name);
        weeklyCounts[personToAssign.originalIndex]++;
    }
    return schedule;
};


// --- API 路由實作 ---
apiRouter.get('/status', async (req, res) => {
    if (isDbConnected) {
        res.status(200).json({ status: 'ok', database: 'connected' });
    } else {
        res.status(200).json({ status: 'ok', database: 'disconnected' });
    }
});

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

apiRouter.put('/profiles/:name/rename', async (req, res) => {
    debugServer(`收到請求: PUT ${req.originalUrl}`);
    const oldName = sanitizeString(req.params.name);
    const { newName } = req.body;
    if (!newName || typeof newName !== 'string' || newName.trim() === '') return res.status(400).json({ message: '新名稱不可為空' });
    const sanitizedNewName = sanitizeString(newName.trim());
    try {
        await db.collection(PROFILES_COLLECTION).updateOne({ _id: CONFIG_ID }, { $rename: { [`profiles.${oldName}`]: `profiles.${sanitizedNewName}` } });
        res.json({ message: `設定檔已從 ${oldName} 改為 ${sanitizedNewName}` });
    } catch (e) {
        debugServer(`PUT /api/profiles/:name/rename 錯誤: %O`, e);
        res.status(500).json({ message: '重新命名失敗', error: e.message });
    }
});

apiRouter.delete('/profiles/:name', async (req, res) => {
    debugServer(`收到請求: DELETE ${req.originalUrl}`);
    const name = sanitizeString(req.params.name);
    try {
        await db.collection(PROFILES_COLLECTION).updateOne({ _id: CONFIG_ID }, { $unset: { [`profiles.${name}`]: "" } });
        res.json({ message: `設定檔 ${name} 已刪除` });
    } catch (e) {
        debugServer(`DELETE /api/profiles/:name 錯誤: %O`, e);
        res.status(500).json({ message: '刪除設定檔失敗', error: e.message });
    }
});

apiRouter.get('/schedules/:name', async (req, res) => {
    debugServer(`收到請求: GET ${req.originalUrl}`);
    const name = sanitizeString(req.params.name);
    try {
        const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
        const scheduleData = config.profiles[config.activeProfile]?.schedules?.[name];
        if (scheduleData) {
            res.json(scheduleData);
        } else {
            res.status(404).json({ message: '找不到班表' });
        }
    } catch (e) {
        debugServer(`GET /api/schedules/:name 錯誤: %O`, e);
        res.status(500).json({ message: '讀取班表失敗', error: e.message });
    }
});

apiRouter.post('/schedules', async (req, res) => {
    debugServer(`收到請求: POST ${req.originalUrl}`);
    const { name, data } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '' || !data) {
        return res.status(400).json({ message: '缺少班表名稱或內容' });
    }
    const sanitizedName = sanitizeString(name.trim());
    try {
        const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
        const activeProfile = config.activeProfile;
        await db.collection(PROFILES_COLLECTION).updateOne(
            { _id: CONFIG_ID },
            { $set: { [`profiles.${activeProfile}.schedules.${sanitizedName}`]: data } }
        );
        res.status(201).json({ message: '班表已儲存' });
    } catch (e) {
        debugServer(`POST /api/schedules 錯誤: %O`, e);
        res.status(500).json({ message: '儲存班表失敗', error: e.message });
    }
});

apiRouter.delete('/schedules/:name', async (req, res) => {
    debugServer(`收到請求: DELETE ${req.originalUrl}`);
    const name = sanitizeString(req.params.name);
    try {
        const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
        const activeProfile = config.activeProfile;
        if (config.profiles[activeProfile]?.schedules?.[name]) {
             await db.collection(PROFILES_COLLECTION).updateOne(
                { _id: CONFIG_ID },
                { $unset: { [`profiles.${activeProfile}.schedules.${name}`]: "" } }
            );
            res.status(200).json({ message: '班表已刪除' });
        } else {
            res.status(404).json({ message: '找不到要刪除的班表' });
        }
    } catch (e) {
        debugServer(`DELETE /api/schedules/:name 錯誤: %O`, e);
        res.status(500).json({ message: '刪除班表失敗', error: e.message });
    }
});

apiRouter.get('/holidays/:year', async (req, res) => {
    debugServer(`收到請求: GET ${req.originalUrl}`);
    const year = sanitizeString(req.params.year);
    try {
        const holidays = await getHolidaysForYear(year);
        res.json(Array.from(holidays));
    } catch (e) {
        debugServer(`GET /api/holidays/:year 錯誤: %O`, e);
        res.status(500).json({ message: '讀取假日資料失敗', error: e.message });
    }
});

apiRouter.post('/generate-schedule', async (req, res) => {
    debugServer(`收到請求: POST ${req.originalUrl}`);
    const { settings, startWeek, numWeeks } = req.body;
    if (!settings || !startWeek || !numWeeks) {
        return res.status(400).json({ message: '缺少必要的排班參數' });
    }
    
    const totalRequiredShifts = 5 * (settings.tasks || []).reduce((sum, task) => sum + (task.count || 0), 0);
    const totalAvailableShifts = (settings.personnel || []).reduce((sum, p) => sum + (p.maxShifts || 0), 0);
    if(totalRequiredShifts > totalAvailableShifts){
        const errorMsg = `排班失敗：總需求班次 (${totalRequiredShifts}) 超過總可用班次 (${totalAvailableShifts})。請增加人力或減少勤務需求。`;
        debugSchedule(errorMsg);
        return res.status(400).json({ message: errorMsg });
    }

    try {
        let generatedData = [];
        const colorSchemes = [
            { header: '#cc4125' }, { header: '#e06666' },
            { header: '#f6b26b' }, { header: '#ffd966' },
            { header: '#93c47d' }, { header: '#76a5af' },
            { header: '#6d9eeb' }, { header: '#6fa8dc' },
            { header: '#8e7cc3' }, { header: '#c27ba0' }
        ];
        for (let i = 0; i < numWeeks; i++) {
            const { year, weekDates, weekDayDates } = getWeekInfo(startWeek, i);
            const holidays = await getHolidaysForYear(year);
            const scheduleDays = weekDates.slice(0, 5).map(dateStr => ({
                shouldSchedule: !holidays.has(dateStr),
                description: holidays.has(dateStr) ? '國定假日' : '',
            }));
            const schedule = generateWeeklySchedule(settings, scheduleDays);
            generatedData.push({
                schedule,
                tasks: settings.tasks,
                dateRange: `${weekDayDates[0]} - ${weekDayDates[4]}`,
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
app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).send({ message: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});


// --- 伺服器啟動函式 ---
const startServer = async () => {
    try {
        debugServer('正在連線至 MongoDB...');
        await client.connect();
        db = client.db(DB_NAME);
        
        client.on('topologyDescriptionChanged', event => {
            const newStatus = event.newDescription.hasReadableServer();
            if (isDbConnected !== newStatus) {
                isDbConnected = newStatus;
                debugDb(`MongoDB 連線狀態改變: ${isDbConnected ? '已連線' : '已中斷'}`);
            }
        });
        
        const pingResult = await db.admin().ping();
        isDbConnected = !!pingResult && pingResult.ok === 1;
        debugDb(`初始 MongoDB 連線狀態: ${isDbConnected ? '已連線' : '已中斷'}`);

        await ensureConfigDocument();
        
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上運行`);
        });
    } catch (err) {
        console.error("無法連線到 MongoDB 或啟動伺服器:", err);
        isDbConnected = false;
        debugServer('伺服器啟動失敗: %O', err);
        // 即使資料庫連線失敗，伺服器還是要啟動
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上運行 (資料庫連線失敗)`);
        });
    }
};

// --- 執行伺服器啟動 ---
startServer();

