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

// --- 快取設定 ---
const holidaysCache = new Map();

// --- 常數設定 ---
const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'scheduleApp';
const CONFIG_ID = 'appConfig';

// --- 資料庫客戶端設定 ---
let client;
let db;
let configCollection;
let isDbConnected = false;

if (MONGODB_URI) {
    client = new MongoClient(MONGODB_URI, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    });
} else {
    debugServer('警告: 未提供 MONGODB_URI 環境變數。資料庫功能將被禁用。');
}

// --- 中介軟體設定 ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 速率限制
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分鐘
    max: 200, // 每個 IP 每 15 分鐘最多 200 次請求
    standardHeaders: true,
    legacyHeaders: false,
    message: '來自此 IP 的請求過多，請於 15 分鐘後再試。'
});
app.use('/api/', apiLimiter);

// --- 輔助函式 ---

// 確保基礎設定文件存在 (更安全版本)
const ensureConfigDocument = async () => {
    debugDb('正在確認主要設定檔...');
    // 使用 $setOnInsert 搭配 upsert: true 是最安全的作法。
    // 這代表：如果文件不存在，就用以下欄位建立它。
    // 如果文件已存在，這個操作將不會做任何事，完美地保留了現有資料。
    const update = {
        $setOnInsert: {
            _id: CONFIG_ID,
            activeProfile: 'default',
            profiles: {
                'default': {
                    settings: { tasks: [], personnel: [] },
                    schedules: {}
                }
            }
        }
    };
    const options = { upsert: true };
    const result = await configCollection.updateOne({ _id: CONFIG_ID }, update, options);

    if (result.upsertedCount > 0) {
        debugDb('找不到設定檔，已成功建立新的預設文件。');
    } else {
        debugDb('設定檔已存在，無需變更。');
    }
};

// 取得週次資訊
const getWeekInfo = (weekString, weekIndex) => {
    const [year, weekNum] = weekString.split('-W').map(Number);
    const simpleDate = new Date(year, 0, 1 + (weekNum - 1) * 7);
    const dayOfWeek = simpleDate.getDay();
    const isoWeekStart = simpleDate;
    if (dayOfWeek <= 4) {
        isoWeekStart.setDate(simpleDate.getDate() - simpleDate.getDay() + 1);
    } else {
        isoWeekStart.setDate(simpleDate.getDate() + 8 - simpleDate.getDay());
    }

    const baseDate = new Date(isoWeekStart);
    baseDate.setDate(baseDate.getDate() + weekIndex * 7);
    
    const weekDates = [];
    const weekDayDates = [];
    for (let i = 0; i < 5; i++) {
        const date = new Date(baseDate);
        date.setDate(date.getDate() + i);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const formattedDate = `${year}${month}${day}`;
        weekDates.push(formattedDate);
        weekDayDates.push(`${month}/${day}`);
    }
    return { year, weekDates, weekDayDates };
};

// 取得年度假日資料 (含快取)
const getHolidaysForYear = async (year) => {
    if (holidaysCache.has(year)) {
        debugDb(`從快取為 ${year} 年讀取假日資料。`);
        return holidaysCache.get(year);
    }

    const filePath = path.join(__dirname, 'holidays', `${year}.json`);
    debugDb(`從檔案系統讀取假日資料: ${filePath}`);
    try {
        const data = await require('fs').promises.readFile(filePath, 'utf-8');
        const holidayData = JSON.parse(data);
        const holidayMap = new Map();
        holidayData.forEach(h => {
            if (h.isHoliday) {
                holidayMap.set(h.date, h.description || h.name || '國定假日');
            }
        });
        holidaysCache.set(year, holidayMap);
        debugDb(`已快取 ${year} 年的 ${holidayMap.size} 個假日項目。`);
        return holidayMap;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            debugServer(`讀取或解析假日檔案 ${filePath} 失敗:`, error.message);
        }
        return new Map();
    }
};

// 預載所有假日檔案至快取
const preloadHolidays = async () => {
    debugServer('正在預先載入所有假日檔案至快取...');
    const holidayDir = path.join(__dirname, 'holidays');
    try {
        const files = await require('fs').promises.readdir(holidayDir);
        const jsonFiles = files.filter(file => file.endsWith('.json'));
        await Promise.all(jsonFiles.map(file => {
            const year = path.basename(file, '.json');
            return getHolidaysForYear(year);
        }));
        debugServer(`成功預載 ${holidaysCache.size} 個年度的假日資料。`);
    } catch (error) {
        debugServer('預載假日檔案時發生錯誤:', error);
    }
};

// 產生單週班表
const generateWeeklySchedule = (settings, scheduleDays) => {
    const { personnel, tasks } = settings;
    let availablePersonnel = [...personnel];
    const weeklySchedule = Array(5).fill(null).map(() => Array(tasks.length).fill(null).map(() => []));
    const shiftCounts = new Map(personnel.map(p => [p.name, 0]));

    for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
        if (!scheduleDays[dayIndex].shouldSchedule) continue;

        let dailyAvailablePersonnel = availablePersonnel.filter(p =>
            !p.offDays?.includes(dayIndex) &&
            (shiftCounts.get(p.name) || 0) < (p.maxShifts || 5)
        );

        for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
            const task = tasks[taskIndex];
            
            let preferredPersonnel = dailyAvailablePersonnel.filter(p => p.preferredTask === task.name);
            let otherPersonnel = dailyAvailablePersonnel.filter(p => p.preferredTask !== task.name);
            
            for (let i = preferredPersonnel.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [preferredPersonnel[i], preferredPersonnel[j]] = [preferredPersonnel[j], preferredPersonnel[i]];
            }
            for (let i = otherPersonnel.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [otherPersonnel[i], otherPersonnel[j]] = [otherPersonnel[j], otherPersonnel[i]];
            }

            const combinedPool = [...preferredPersonnel, ...otherPersonnel];

            for (let i = 0; i < task.count; i++) {
                if (combinedPool.length > 0) {
                    const person = combinedPool.shift();
                    weeklySchedule[dayIndex][taskIndex].push(person.name);
                    shiftCounts.set(person.name, (shiftCounts.get(person.name) || 0) + 1);
                    dailyAvailablePersonnel = dailyAvailablePersonnel.filter(p => p.name !== person.name);
                } else {
                     weeklySchedule[dayIndex][taskIndex].push('人力不足');
                }
            }
        }
    }
    return weeklySchedule;
};


// --- API 路由 ---

// 取得伺服器與資料庫狀態
app.get('/api/status', (req, res) => {
    res.json({
        server: 'running',
        database: isDbConnected ? 'connected' : 'disconnected'
    });
});

// 取得所有設定檔
app.get('/api/profiles', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const config = await configCollection.findOne({ _id: CONFIG_ID });
        res.json(config || {});
    } catch (error) {
        debugDb('讀取設定檔失敗:', error);
        res.status(500).json({ message: '讀取設定檔時發生錯誤' });
    }
});

// 更新作用中的設定檔
app.put('/api/profiles/active', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { name } = req.body;
        const result = await configCollection.updateOne({ _id: CONFIG_ID }, { $set: { activeProfile: name } });
        if (result.modifiedCount === 0) throw new Error('找不到設定檔或無需更新');
        res.json({ message: '作用中的設定檔已更新' });
    } catch (error) {
        debugDb('更新作用中設定檔失敗:', error);
        res.status(500).json({ message: '更新作用中設定檔時發生錯誤' });
    }
});

// 新增設定檔
app.post('/api/profiles', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { name } = req.body;
        const update = {
            $set: {
                [`profiles.${name}`]: { settings: { tasks: [], personnel: [] }, schedules: {} }
            }
        };
        const result = await configCollection.updateOne({ _id: CONFIG_ID, [`profiles.${name}`]: { $exists: false } }, update);
        if (result.modifiedCount === 0) throw new Error('設定檔已存在');
        res.status(201).json({ message: '設定檔已新增' });
    } catch (error) {
        debugDb('新增設定檔失敗:', error);
        res.status(500).json({ message: error.message || '新增設定檔時發生錯誤' });
    }
});

// 更新特定設定檔的設定
app.put('/api/profiles/:name', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { name } = req.params;
        const { settings } = req.body;
        const result = await configCollection.updateOne({ _id: CONFIG_ID }, { $set: { [`profiles.${name}.settings`]: settings } });
        if (result.modifiedCount === 0) throw new Error('找不到設定檔或無需更新');
        res.json({ message: `設定檔 ${name} 已更新` });
    } catch (error) {
        debugDb('更新設定檔失敗:', error);
        res.status(500).json({ message: '更新設定檔時發生錯誤' });
    }
});

// 重新命名設定檔
app.put('/api/profiles/:name/rename', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const oldName = req.params.name;
        const { newName } = req.body;
        const config = await configCollection.findOne({ _id: CONFIG_ID });
        if (!config.profiles[oldName] || config.profiles[newName]) {
            return res.status(400).json({ message: '無效的名稱或新名稱已存在' });
        }
        
        let update = { $rename: { [`profiles.${oldName}`]: `profiles.${newName}` } };
        if (config.activeProfile === oldName) {
            update.$set = { activeProfile: newName };
        }
        
        const result = await configCollection.updateOne({ _id: CONFIG_ID }, update);
        if (result.modifiedCount === 0) throw new Error('重新命名失敗');
        res.json({ message: '設定檔已重新命名' });
    } catch (error) {
        debugDb('重新命名設定檔失敗:', error);
        res.status(500).json({ message: '重新命名設定檔時發生錯誤' });
    }
});

// 刪除設定檔
app.delete('/api/profiles/:name', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const nameToDelete = req.params.name;
        const config = await configCollection.findOne({ _id: CONFIG_ID });
        const profileKeys = Object.keys(config.profiles);
        if (profileKeys.length <= 1) return res.status(400).json({ message: '無法刪除最後一個設定檔' });

        let update = { $unset: { [`profiles.${nameToDelete}`]: "" } };
        if (config.activeProfile === nameToDelete) {
            const newActiveProfile = profileKeys.find(key => key !== nameToDelete);
            update.$set = { activeProfile: newActiveProfile };
        }

        await configCollection.updateOne({ _id: CONFIG_ID }, update);
        res.json({ message: '設定檔已刪除' });
    } catch (error) {
        debugDb('刪除設定檔失敗:', error);
        res.status(500).json({ message: '刪除設定檔時發生錯誤' });
    }
});

// 儲存班表
app.post('/api/schedules', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { name, data } = req.body;
        const config = await configCollection.findOne({ _id: CONFIG_ID });
        const activeProfile = config.activeProfile;
        const result = await configCollection.updateOne(
            { _id: CONFIG_ID },
            { $set: { [`profiles.${activeProfile}.schedules.${name}`]: data } }
        );
        if (result.modifiedCount === 0) throw new Error('儲存班表失敗');
        res.status(201).json({ message: '班表已儲存' });
    } catch (error) {
        debugDb('儲存班表失敗:', error);
        res.status(500).json({ message: '儲存班表時發生錯誤' });
    }
});

// 取得特定班表
app.get('/api/schedules/:name', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { name } = req.params;
        const config = await configCollection.findOne({ _id: CONFIG_ID });
        const scheduleData = config.profiles[config.activeProfile]?.schedules?.[name];
        if (!scheduleData) return res.status(404).json({ message: '找不到班表' });
        res.json(scheduleData);
    } catch (error) {
        debugDb('取得班表失敗:', error);
        res.status(500).json({ message: '取得班表時發生錯誤' });
    }
});


// 刪除特定班表
app.delete('/api/schedules/:name', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { name } = req.params;
        const config = await configCollection.findOne({ _id: CONFIG_ID });
        const activeProfile = config.activeProfile;
        const result = await configCollection.updateOne(
            { _id: CONFIG_ID },
            { $unset: { [`profiles.${activeProfile}.schedules.${name}`]: "" } }
        );
        if (result.modifiedCount === 0) throw new Error('刪除班表失敗');
        res.json({ message: '班表已刪除' });
    } catch (error) {
        debugDb('刪除班表失敗:', error);
        res.status(500).json({ message: '刪除班表時發生錯誤' });
    }
});

// 產生班表
app.post('/api/generate-schedule', async (req, res) => {
    try {
        const { settings, startWeek, numWeeks } = req.body;
        debugSchedule('收到班表產生請求:', { startWeek, numWeeks });

        const fullScheduleData = [];
        const colors = [
            { header: '#0284c7', row: '#f0f9ff' },
            { header: '#15803d', row: '#f0fdf4' },
            { header: '#be185d', row: '#fdf2f8' },
            { header: '#86198f', row: '#faf5ff' },
        ];

        for (let i = 0; i < numWeeks; i++) {
            const { year, weekDates, weekDayDates } = getWeekInfo(startWeek, i);
            const holidays = await getHolidaysForYear(year);
            const scheduleDays = weekDates.map(date => ({
                date,
                shouldSchedule: !holidays.has(date),
                description: holidays.get(date) || ''
            }));
            
            const weeklySchedule = generateWeeklySchedule(settings, scheduleDays);
            
            fullScheduleData.push({
                schedule: weeklySchedule,
                tasks: settings.tasks,
                dateRange: `${weekDayDates[0]} - ${weekDayDates[4]}`,
                weekDayDates,
                scheduleDays,
                color: colors[i % colors.length]
            });
        }
        res.json(fullScheduleData);
    } catch (error) {
        debugSchedule('產生班表時發生錯誤:', error);
        res.status(500).json({ message: '產生班表時發生未預期的錯誤' });
    }
});

// --- 根路由 ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 伺服器啟動函式 ---
const startServer = async () => {
    if (!client) {
        await preloadHolidays();
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上運行 (資料庫模式已禁用)`);
        });
        return;
    }
    try {
        debugServer('正在連線至 MongoDB...');
        await client.connect();
        await client.db("admin").command({ ping: 1 });
        debugDb("成功 Ping 到您的部署。您已成功連線至 MongoDB！");
        db = client.db(DB_NAME);
        configCollection = db.collection('config'); // 修正：確保使用 'config' collection
        isDbConnected = true;
        
        if (isDbConnected) {
            await ensureConfigDocument();
        }
        
        await preloadHolidays();
        
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上運行`);
        });
    } catch (err) {
        console.error("無法連線到 MongoDB 或啟動伺服器:", err);
        isDbConnected = false;
        debugServer('伺服器啟動失敗: %O', err);

        await preloadHolidays();
        
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上運行 (資料庫連線失敗)`);
        });
    }
};

// --- 執行伺服器啟動 ---
startServer();

// --- 應用程式關閉處理 ---
process.on('SIGINT', async () => {
    debugServer('收到 SIGINT。正在關閉連線...');
    if (client) {
        await client.close();
    }
    process.exit(0);
});

