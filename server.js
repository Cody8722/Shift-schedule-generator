// --- 模組引入 ---
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises; // 引入 fs 模組
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
const CONFIG_ID = 'main_config'; 

// --- 資料庫客戶端設定 ---
let client;
let db;
let configCollection;
let holidaysCollection;
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

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: '來自此 IP 的請求過多，請於 15 分鐘後再試。'
});
app.use('/api/', apiLimiter);

// --- 輔助函式 ---
const ensureConfigDocument = async () => {
    debugDb('正在確認主要設定檔...');
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

const getWeekInfo = (weekString, weekIndex) => {
    const [year, weekNum] = weekString.split('-W').map(Number);
    const simpleDate = new Date(Date.UTC(year, 0, 1 + (weekNum - 1) * 7));
    const dayOfWeek = simpleDate.getUTCDay() || 7;
    simpleDate.setUTCDate(simpleDate.getUTCDate() + 1 - dayOfWeek);
    
    const baseDate = new Date(simpleDate);
    baseDate.setUTCDate(baseDate.getUTCDate() + weekIndex * 7);

    const weekDates = [];
    const weekDayDates = [];
    for (let i = 0; i < 5; i++) {
        const date = new Date(baseDate);
        date.setUTCDate(date.getUTCDate() + i);
        const currentYear = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const formattedDate = `${currentYear}${month}${day}`;
        weekDates.push(formattedDate);
        weekDayDates.push(`${month}/${day}`);
    }
    return { weekDates, weekDayDates };
};

const getHolidaysForYear = async (year) => {
    if (holidaysCache.has(year)) {
        debugDb(`從快取為 ${year} 年讀取假日資料。`);
        return holidaysCache.get(year);
    }
    
    if (!isDbConnected) return new Map();

    debugDb(`從資料庫讀取 ${year} 年的假日資料...`);
    try {
        const yearStr = String(year);
        const holidays = await holidaysCollection.find({ _id: { $regex: `^${yearStr}` }, isHoliday: true }).toArray();
        const holidayMap = new Map();
        holidays.forEach(h => {
            holidayMap.set(h._id, h.name);
        });
        holidaysCache.set(year, holidayMap);
        debugDb(`已快取 ${year} 年的 ${holidayMap.size} 個假日項目。`);
        return holidayMap;
    } catch (error) {
        debugDb(`讀取 ${year} 年假日資料失敗:`, error);
        return new Map();
    }
};

const seedHolidays = async () => {
    try {
        const count = await holidaysCollection.countDocuments();
        if (count > 0) {
            debugDb('假日資料庫已有資料，無需植入。');
            return;
        }

        debugDb('假日資料庫為空，開始從 JSON 檔案植入初始資料...');
        const holidayDir = path.join(__dirname, 'holidays');
        const files = await fs.readdir(holidayDir);
        const jsonFiles = files.filter(file => file.endsWith('.json'));

        let totalHolidaysInserted = 0;

        for (const file of jsonFiles) {
            const filePath = path.join(holidayDir, file);
            const data = await fs.readFile(filePath, 'utf-8');
            const holidayData = JSON.parse(data);

            const documents = holidayData
                .filter(h => h.isHoliday && h.date)
                .map(h => ({
                    _id: h.date,
                    name: h.name || h.description || '國定假日',
                    isHoliday: true,
                }));

            if (documents.length > 0) {
                // Use ordered: false to continue inserting even if some documents fail (e.g., duplicate keys)
                await holidaysCollection.insertMany(documents, { ordered: false }).catch(err => {
                    if (err.code !== 11000) { // Ignore duplicate key errors
                        throw err;
                    }
                });
                totalHolidaysInserted += documents.length;
                debugDb(`已從 ${file} 植入 ${documents.length} 筆假日資料。`);
            }
        }
        debugDb(`共植入 ${totalHolidaysInserted} 筆初始假日資料。`);
    } catch (error) {
        debugServer('植入初始假日資料時發生錯誤:', error);
    }
};


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

const generateScheduleHtml = (fullScheduleData) => {
    let html = '';
    fullScheduleData.forEach((data, index) => {
        const { schedule, tasks, dateRange, weekDayDates, scheduleDays, color } = data;
        const weekDayNames = ['一', '二', '三', '四', '五'];
        const headerStyle = `style="background-color: ${color.header}; color: white;"`;
        html += `
            <div class="mb-8" id="schedule-week-${index}">
                <h3 class="text-xl font-bold mb-2">第 ${index + 1} 週班表 (${dateRange})</h3>
                <table class="schedule-table">
                    <thead>
                        <tr>
                            <th ${headerStyle}>勤務地點</th>
                            ${weekDayDates.map((date, i) => `<th ${headerStyle}>星期${weekDayNames[i]}<br>(${date})</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${tasks.map((task, taskIndex) => `
                            <tr>
                                <td class="font-medium align-middle">${task.name}</td>
                                ${weekDayDates.map((_, dayIndex) => {
                                    if (!scheduleDays[dayIndex].shouldSchedule) {
                                        return `<td class="holiday-cell align-middle">${scheduleDays[dayIndex].description}</td>`;
                                    } else {
                                        return `<td class="align-middle">${schedule[dayIndex][taskIndex].join('<br>')}</td>`;
                                    }
                                }).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    });
    return html;
};

// --- API 路由 ---
app.get('/api/status', (req, res) => res.json({ server: 'running', database: isDbConnected ? 'connected' : 'disconnected' }));

// --- Holiday API Routes ---
app.get('/api/holidays/:year', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const year = req.params.year;
        const holidays = await holidaysCollection.find({ _id: { $regex: `^${year}` }, isHoliday: true }).toArray();
        res.json(holidays.map(h => ({ date: h._id, name: h.name })));
    } catch(error) {
        debugDb('讀取年度假日失敗:', error);
        res.status(500).json({ message: '讀取年度假日失敗' });
    }
});

app.put('/api/holidays', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { date, name, isHoliday } = req.body;
        if (!date) return res.status(400).json({ message: '日期為必填欄位' });
        
        const year = parseInt(date.substring(0, 4));
        holidaysCache.delete(year);

        if (isHoliday) {
            await holidaysCollection.updateOne({ _id: date }, { $set: { name, isHoliday: true } }, { upsert: true });
        } else {
            await holidaysCollection.deleteOne({ _id: date });
        }
        res.json({ message: '假日設定已更新' });
    } catch (error) {
        debugDb('更新假日設定失敗:', error);
        res.status(500).json({ message: '更新假日設定失敗' });
    }
});

app.get('/api/holidays-in-range', async (req, res) => {
    const { startWeek, numWeeks } = req.query;
    if (!startWeek || !numWeeks) {
        return res.status(400).json({ message: "缺少 startWeek 或 numWeeks 參數" });
    }
    try {
        const allDatesInRange = [];
        const numWeeksInt = parseInt(numWeeks, 10);
        for (let i = 0; i < numWeeksInt; i++) {
            const { weekDates } = getWeekInfo(startWeek, i);
            allDatesInRange.push(...weekDates);
        }
        const years = [...new Set(allDatesInRange.map(d => parseInt(d.substring(0, 4))))];
        const allHolidayMaps = await Promise.all(years.map(year => getHolidaysForYear(year)));
        const combinedHolidays = new Map();
        allHolidayMaps.forEach(holidayMap => {
            for (const [date, name] of holidayMap.entries()) {
                combinedHolidays.set(date, name);
            }
        });
        const holidaysInRange = allDatesInRange
            .filter(date => combinedHolidays.has(date))
            .map(date => ({ date, name: combinedHolidays.get(date) }));
        res.json(holidaysInRange);
    } catch (error) {
        debugSchedule('查詢區間假日失敗:', error);
        res.status(500).json({ message: '查詢假日資料時發生錯誤' });
    }
});

// --- Profile and Schedule API Routes ---
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

app.post('/api/profiles', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { name } = req.body;
        const update = { $set: { [`profiles.${name}`]: { settings: { tasks: [], personnel: [] }, schedules: {} } } };
        const result = await configCollection.updateOne({ _id: CONFIG_ID, [`profiles.${name}`]: { $exists: false } }, update);
        if (result.modifiedCount === 0) throw new Error('設定檔已存在');
        res.status(201).json({ message: '設定檔已新增' });
    } catch (error) {
        debugDb('新增設定檔失敗:', error);
        res.status(500).json({ message: error.message || '新增設定檔時發生錯誤' });
    }
});

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

app.post('/api/schedules', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { name, data } = req.body;
        const config = await configCollection.findOne({ _id: CONFIG_ID });
        const activeProfile = config.activeProfile;
        const result = await configCollection.updateOne({ _id: CONFIG_ID }, { $set: { [`profiles.${activeProfile}.schedules.${name}`]: data } });
        if (result.modifiedCount === 0) throw new Error('儲存班表失敗');
        res.status(201).json({ message: '班表已儲存' });
    } catch (error) {
        debugDb('儲存班表失敗:', error);
        res.status(500).json({ message: '儲存班表時發生錯誤' });
    }
});

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

app.delete('/api/schedules/:name', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { name } = req.params;
        const config = await configCollection.findOne({ _id: CONFIG_ID });
        const activeProfile = config.activeProfile;
        const result = await configCollection.updateOne({ _id: CONFIG_ID }, { $unset: { [`profiles.${activeProfile}.schedules.${name}`]: "" } });
        if (result.modifiedCount === 0) throw new Error('刪除班表失敗');
        res.json({ message: '班表已刪除' });
    } catch (error) {
        debugDb('刪除班表失敗:', error);
        res.status(500).json({ message: '刪除班表時發生錯誤' });
    }
});

app.post('/api/generate-schedule', async (req, res) => {
    try {
        const { settings, startWeek, numWeeks, activeHolidays } = req.body;
        const fullScheduleData = [];
        const colors = [ { header: '#0284c7', row: '#f0f9ff' }, { header: '#15803d', row: '#f0fdf4' }, { header: '#be185d', row: '#fdf2f8' }, { header: '#86198f', row: '#faf5ff' } ];
        for (let i = 0; i < numWeeks; i++) {
            const { weekDates, weekDayDates } = getWeekInfo(startWeek, i);
            const years = [...new Set(weekDates.map(d => parseInt(d.substring(0, 4))))];
            const allHolidayMaps = await Promise.all(years.map(year => getHolidaysForYear(year)));
            const originalHolidaysMap = new Map();
            allHolidayMaps.forEach(holidayMap => {
                for (const [date, name] of holidayMap.entries()) {
                    originalHolidaysMap.set(date, name);
                }
            });
            const scheduleDays = weekDates.map(date => ({
                date,
                shouldSchedule: !activeHolidays.includes(date),
                description: activeHolidays.includes(date) ? originalHolidaysMap.get(date) || '假日' : ''
            }));
            const weeklySchedule = generateWeeklySchedule(settings, scheduleDays);
            fullScheduleData.push({ schedule: weeklySchedule, tasks: settings.tasks, dateRange: `${weekDayDates[0]} - ${weekDayDates[4]}`, weekDayDates, scheduleDays, color: colors[i % colors.length] });
        }
        
        const scheduleHtml = generateScheduleHtml(fullScheduleData);

        res.json({ data: fullScheduleData, html: scheduleHtml });
    } catch (error) {
        debugSchedule('產生班表時發生錯誤:', error);
        res.status(500).json({ message: '產生班表時發生未預期的錯誤' });
    }
});

app.post('/api/render-schedule', (req, res) => {
    try {
        const fullScheduleData = req.body;
        if (!Array.isArray(fullScheduleData)) {
            return res.status(400).json({ message: '無效的班表資料格式' });
        }
        const scheduleHtml = generateScheduleHtml(fullScheduleData);
        res.json({ html: scheduleHtml });
    } catch (error) {
        debugSchedule('渲染已儲存班表時發生錯誤:', error);
        res.status(500).json({ message: '渲染班表時發生未預期的錯誤' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 伺服器啟動函式 ---
const startServer = async () => {
    if (!client) {
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
        configCollection = db.collection('profiles'); 
        holidaysCollection = db.collection('holidays');
        isDbConnected = true;
        
        if (isDbConnected) {
            await ensureConfigDocument();
            await seedHolidays();
        }
        
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上運行`);
        });
    } catch (err) {
        console.error("無法連線到 MongoDB 或啟動伺服器:", err);
        isDbConnected = false;
        debugServer('伺服器啟動失敗: %O', err);
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上運行 (資料庫連線失敗)`);
        });
    }
};

startServer();

process.on('SIGINT', async () => {
    debugServer('收到 SIGINT。正在關閉連線...');
    if (client) {
        await client.close();
    }
    process.exit(0);
});

