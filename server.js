// --- 模組引入 ---
const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient, ServerApiVersion } = require('mongodb');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

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
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // 增加連線穩定性設定
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000, // 5秒內連不上就放棄
});

let db;

// --- 中介軟體 (Middleware) ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));
app.use('/api/', limiter); // 只對 API 路由啟用頻率限制

// --- 伺服器啟動與資料庫連線 ---
const startServer = async () => {
    try {
        await client.connect();
        console.log("已成功連線到 MongoDB Atlas!");
        db = client.db(DB_NAME);
        
        // 監聽連線中斷事件
        client.on('close', () => console.log('MongoDB 連線已中斷'));
        client.on('reconnect', () => console.log('已成功重新連線到 MongoDB'));

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


// --- 輔助函式 ---
const ensureConfigDocument = async () => {
    const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
    if (!config) {
        console.log("找不到設定檔文件，正在建立新的...");
        await db.collection(PROFILES_COLLECTION).insertOne({
            _id: CONFIG_ID, activeProfile: 'default',
            profiles: { 'default': { settings: { tasks: [], personnel: [] }, schedules: {} } }
        });
    }
};

const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/[<>&"']/g, ''); // 移除基礎的 HTML/Script 標籤字元
};

// --- API 路由 ---
app.get('/api/profiles', async (req, res) => {
    try {
        const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
        res.json(config);
    } catch (e) { res.status(500).json({ message: '讀取設定檔時發生錯誤', error: e.message }); }
});

app.put('/api/profiles/active', async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ message: '設定檔名稱格式錯誤' });
    try {
        await db.collection(PROFILES_COLLECTION).updateOne({ _id: CONFIG_ID }, { $set: { activeProfile: sanitizeString(name) } });
        res.json({ message: `已切換至設定檔 ${name}` });
    } catch (e) { res.status(500).json({ message: '切換設定檔失敗', error: e.message }); }
});

app.post('/api/profiles', async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') return res.status(400).json({ message: '設定檔名稱不可為空' });
    const sanitizedName = sanitizeString(name.trim());
    try {
        // 檢查名稱是否已存在
        const config = await db.collection(PROFILES_COLLECTION).findOne({ _id: CONFIG_ID });
        if(config.profiles[sanitizedName]) {
            return res.status(409).json({ message: '設定檔名稱已存在' }); // 409 Conflict
        }

        const newProfile = { settings: { tasks: [], personnel: [] }, schedules: {} };
        await db.collection(PROFILES_COLLECTION).updateOne({ _id: CONFIG_ID }, { $set: { [`profiles.${sanitizedName}`]: newProfile } });
        res.status(201).json({ message: `已新增設定檔 ${sanitizedName}` });
    } catch (e) { res.status(500).json({ message: '新增設定檔失敗', error: e.message }); }
});

app.put('/api/profiles/:name', async (req, res) => {
    const name = sanitizeString(req.params.name);
    const { settings } = req.body;
    // --- 伺服器端驗證 ---
    if (!settings || typeof settings !== 'object' || !Array.isArray(settings.tasks) || !Array.isArray(settings.personnel)) {
        return res.status(400).json({ message: '設定資料格式錯誤' });
    }
    try {
        // --- 資料清理 ---
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
    } catch (e) { res.status(500).json({ message: '更新設定檔失敗', error: e.message }); }
});

// 其他 Profile & Schedule 路由 (省略以保持簡潔，邏輯與上方類似)
// ... (Rename, Delete, Get Schedule, Save Schedule, Delete Schedule) ...

// --- 排班演算法 (保持不變，因為已經是最終修正版) ---
const generateWeeklySchedule = (settings, scheduleDays) => {
    // ... (此處的演算法維持上次修正的最終版本)
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


// ... (Holiday & Generate Schedule API 端點，省略以保持簡潔)
// ...
// ... (完整的 server.js 內容，請參考之前的版本，此處僅展示新增與修改的部分)

