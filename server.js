// --- 模組引入 ---
const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config(); // 引入 dotenv 來讀取 .env 檔案

// --- 常數設定 ---
const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'scheduleApp'; // 您可以指定資料庫名稱
const PROFILES_COLLECTION = 'profiles';
const CONFIG_ID = 'main_config'; // 使用一個固定的文件 ID 來儲存所有設定檔

// --- 檢查環境變數 ---
if (!MONGODB_URI) {
    console.error('錯誤：請在 .env 檔案中設定 MONGODB_URI');
    process.exit(1); // 缺少關鍵設定，直接結束程式
}

// --- MongoDB 客戶端設定 ---
const client = new MongoClient(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db; // 用來儲存資料庫連線

// --- 中介軟體 (Middleware) ---
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 增加 JSON body 的大小限制
app.use(express.static(path.join(__dirname))); // 伺服靜態檔案 (例如 index.html)

// --- API 路由 (Routes) ---

// 輔助函式：確保設定檔文件存在
const ensureConfigDocument = async () => {
    const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
    if (!config) {
        console.log("找不到設定檔文件，正在建立新的...");
        await db.collection(PROFILES_COLLECTION).insertOne({
            _id: CONFIG_ID,
            activeProfile: 'default',
            profiles: {
                'default': {
                    settings: { tasks: [], personnel: [] },
                    schedules: {}
                }
            }
        });
    }
};

// GET /api/profiles - 獲取所有設定檔
app.get('/api/profiles', async (req, res) => {
    try {
        const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
        res.json(config);
    } catch (e) {
        res.status(500).json({ message: '讀取設定檔時發生錯誤', error: e.message });
    }
});

// PUT /api/profiles/active - 設定當前活動的設定檔
app.put('/api/profiles/active', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: '缺少設定檔名稱' });
    try {
        await db.collection(PROFILES_COLLECTION).updateOne(
            { _id: CONFIG_ID },
            { $set: { activeProfile: name } }
        );
        res.json({ message: `已切換至設定檔 ${name}` });
    } catch (e) {
        res.status(500).json({ message: '切換設定檔失敗', error: e.message });
    }
});

// POST /api/profiles - 新增一個設定檔
app.post('/api/profiles', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: '缺少設定檔名稱' });
    try {
        const newProfile = { settings: { tasks: [], personnel: [] }, schedules: {} };
        await db.collection(PROFILES_COLLECTION).updateOne(
            { _id: CONFIG_ID },
            { $set: { [`profiles.${name}`]: newProfile } }
        );
        res.status(201).json({ message: `已新增設定檔 ${name}` });
    } catch (e) {
        res.status(500).json({ message: '新增設定檔失敗', error: e.message });
    }
});

// PUT /api/profiles/:name - 更新一個設定檔的設定
app.put('/api/profiles/:name', async (req, res) => {
    const { name } = req.params;
    const { settings } = req.body;
    if (!settings) return res.status(400).json({ message: '缺少設定內容' });
    try {
        await db.collection(PROFILES_COLLECTION).updateOne(
            { _id: CONFIG_ID },
            { $set: { [`profiles.${name}.settings`]: settings } }
        );
        res.json({ message: `設定檔 ${name} 已更新` });
    } catch (e) {
        res.status(500).json({ message: '更新設定檔失敗', error: e.message });
    }
});

// PUT /api/profiles/:name/rename - 重新命名設定檔
app.put('/api/profiles/:name/rename', async (req, res) => {
    const oldName = req.params.name;
    const { newName } = req.body;
    if (!newName) return res.status(400).json({ message: '缺少新名稱' });
    try {
        await db.collection(PROFILES_COLLECTION).updateOne(
            { _id: CONFIG_ID },
            { $rename: { [`profiles.${oldName}`]: `profiles.${newName}` } }
        );
        res.json({ message: `設定檔已從 ${oldName} 改為 ${newName}` });
    } catch (e) {
        res.status(500).json({ message: '重新命名失敗', error: e.message });
    }
});

// DELETE /api/profiles/:name - 刪除一個設定檔
app.delete('/api/profiles/:name', async (req, res) => {
    const { name } = req.params;
    try {
        await db.collection(PROFILES_COLLECTION).updateOne(
            { _id: CONFIG_ID },
            { $unset: { [`profiles.${name}`]: "" } }
        );
        res.json({ message: `設定檔 ${name} 已刪除` });
    } catch (e) {
        res.status(500).json({ message: '刪除設定檔失敗', error: e.message });
    }
});

// --- Schedule API Routes ---
app.get('/api/schedules/:name', async (req, res) => {
    const { name } = req.params;
    try {
        const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
        const scheduleData = config.profiles[config.activeProfile]?.schedules?.[name];
        if (scheduleData) {
            res.json(scheduleData);
        } else {
            res.status(404).json({ message: '找不到班表' });
        }
    } catch (e) {
        res.status(500).json({ message: '讀取班表失敗', error: e.message });
    }
});

app.post('/api/schedules', async (req, res) => {
    const { name, data } = req.body;
    if (!name || !data) return res.status(400).json({ message: '缺少名稱或內容' });
    try {
        const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
        const activeProfile = config.activeProfile;
        await db.collection(PROFILES_COLLECTION).updateOne(
            { _id: CONFIG_ID },
            { $set: { [`profiles.${activeProfile}.schedules.${name}`]: data } }
        );
        res.status(201).json({ message: '班表已儲存' });
    } catch (e) {
        res.status(500).json({ message: '儲存班表失敗', error: e.message });
    }
});

app.delete('/api/schedules/:name', async (req, res) => {
    const { name } = req.params;
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
        res.status(500).json({ message: '刪除班表失敗', error: e.message });
    }
});

// --- Holiday API Route ---
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
        console.warn(`找不到 ${year} 年的假日檔案:`, error.message);
        holidaysCache[year] = new Set();
        return holidaysCache[year];
    }
};

app.get('/api/holidays/:year', async (req, res) => {
    const { year } = req.params;
    const filePath = path.join(__dirname, 'holidays', `${year}.json`);
    try {
        const data = await require('fs').promises.readFile(filePath, 'utf-8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(404).json({ message: `${year} 年的假日檔案不存在` });
    }
});


// --- Schedule Generation API Route ---

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

const generateWeeklySchedule = (settings, scheduleDays) => {
    const { personnel, tasks } = settings;
    const sanitizedPersonnel = personnel.map(p => ({
        ...p,
        maxShifts: parseInt(p.maxShifts, 10) || 5,
    }));

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
        
        if (availablePersonnel.length === 0) {
            continue;
        }

        availablePersonnel.sort((a, b) => {
            const countA = weeklyCounts[a.originalIndex];
            const countB = weeklyCounts[b.originalIndex];
            if (countA !== countB) {
                return countA - countB;
            }
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

app.post('/api/generate-schedule', async (req, res) => {
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
        console.error("排班時發生錯誤:", e);
        res.status(500).json({ message: '產生班表時發生內部錯誤', error: e.message });
    }
});


// --- 啟動伺服器 ---
const startServer = async () => {
    try {
        await client.connect();
        console.log("已成功連線到 MongoDB Atlas!");
        db = client.db(DB_NAME);
        await ensureConfigDocument();
        app.listen(PORT, () => {
            console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
        });
    } catch (err) {
        console.error("無法連線到 MongoDB 或啟動伺服器:", err);
        process.exit(1);
    }
};

startServer();

