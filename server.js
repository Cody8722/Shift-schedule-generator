const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');
const DEFAULT_PROFILE_NAME = 'default';

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- Database Helper Functions ---

// 讀取資料庫檔案
const readDb = async () => {
    try {
        await fs.access(DB_PATH);
        const data = await fs.readFile(DB_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        // 如果檔案不存在或毀損，就建立一個新的
        console.log("找不到 database.json，正在建立新的...");
        const initialData = {
            activeProfile: DEFAULT_PROFILE_NAME,
            profiles: {
                [DEFAULT_PROFILE_NAME]: {
                    settings: {},
                    schedules: {}
                }
            }
        };
        await fs.writeFile(DB_PATH, JSON.stringify(initialData, null, 2));
        return initialData;
    }
};

// 寫入資料庫檔案 (包含備份)
const writeDb = async (data) => {
    try {
        // 1. 建立備份
        const backupPath = path.join(__dirname, `database_backup_${Date.now()}.json`);
        await fs.copyFile(DB_PATH, backupPath);
        
        // 2. 寫入新資料
        await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("寫入資料庫失敗:", error);
        throw new Error("無法寫入資料庫檔案。");
    }
};

// --- Holiday Data Caching ---
let cachedHolidays = null;
async function loadHolidays() {
    if (cachedHolidays) return cachedHolidays;
    
    const holidaysDir = path.join(__dirname, 'holidays');
    let allHolidays = [];
    
    try {
        const files = await fs.readdir(holidaysDir);
        for (const file of files) {
            if (path.extname(file) === '.json') {
                const filePath = path.join(holidaysDir, file);
                const fileContent = await fs.readFile(filePath, 'utf-8');
                const yearHolidays = JSON.parse(fileContent);
                allHolidays = allHolidays.concat(yearHolidays);
            }
        }
        cachedHolidays = allHolidays;
        console.log(`成功載入 ${cachedHolidays.length} 筆假日資料。`);
        return cachedHolidays;
    } catch (error) {
        console.error("!!! 讀取假日資料檔案失敗:", error);
        return []; 
    }
}


// === API Endpoints ===

// GET holiday data
app.get('/api/holidays', async (req, res) => {
    try {
        const holidays = await loadHolidays();
        if (holidays.length === 0) {
            return res.status(500).json({ message: "伺服器上找不到假日資料檔案。" });
        }
        res.json(holidays);
    } catch (e) {
        res.status(500).json({ message: "讀取假日資料時發生伺服器錯誤。" });
    }
});


// GET all data
app.get('/api/data', async (req, res) => {
    try {
        const db = await readDb();
        res.json(db);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// POST a new profile
app.post('/api/profiles', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: '缺少名稱' });
    try {
        const db = await readDb();
        if (db.profiles[name]) {
            return res.status(409).json({ message: '設定檔名稱已存在' });
        }
        db.profiles[name] = { settings: {}, schedules: {} };
        db.activeProfile = name;
        await writeDb(db);
        res.status(201).json({ message: '設定檔已建立' });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST to rename a profile
app.post('/api/profiles/rename', async (req, res) => {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) return res.status(400).json({ message: '缺少新舊名稱' });
    try {
        const db = await readDb();
        if (!db.profiles[oldName]) return res.status(404).json({ message: '找不到要重新命名的設定檔' });
        if (db.profiles[newName]) return res.status(409).json({ message: '新的設定檔名稱已存在' });
        
        db.profiles[newName] = db.profiles[oldName];
        delete db.profiles[oldName];
        if (db.activeProfile === oldName) {
            db.activeProfile = newName;
        }
        await writeDb(db);
        res.status(200).json({ message: '重新命名成功' });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST to delete a profile
app.post('/api/profiles/delete', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: '缺少名稱' });
    if (name === DEFAULT_PROFILE_NAME) return res.status(400).json({ message: '無法刪除預設設定檔' });
     try {
        const db = await readDb();
        if (!db.profiles[name]) return res.status(404).json({ message: '找不到要刪除的設定檔' });

        delete db.profiles[name];
        if (db.activeProfile === name) {
            db.activeProfile = DEFAULT_PROFILE_NAME;
        }
        await writeDb(db);
        res.status(200).json({ message: '刪除成功' });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST to import settings
app.post('/api/profiles/import', async (req, res) => {
    const { name, settings } = req.body;
    if (!name || settings === undefined) return res.status(400).json({ message: '缺少名稱或設定' });
    try {
        const db = await readDb();
        if (db.profiles[name]) {
             return res.status(409).json({ message: '設定檔名稱已存在' });
        }
        db.profiles[name] = { settings, schedules: {} };
        db.activeProfile = name;
        await writeDb(db);
        res.status(201).json({ message: '設定已匯入為新設定檔' });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST active profile
app.post('/api/active_profile', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: '缺少名稱' });
    try {
        const db = await readDb();
        if (!db.profiles[name]) return res.status(404).json({ message: '找不到指定的設定檔' });
        db.activeProfile = name;
        await writeDb(db);
        res.status(200).json({ message: '已切換作用中設定檔' });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST settings
app.post('/api/settings', async (req, res) => {
    const settings = req.body;
    try {
        const db = await readDb();
        db.profiles[db.activeProfile].settings = settings;
        await writeDb(db);
        res.status(200).json({ message: '設定已儲存' });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET schedule data
app.get('/api/schedules/:name', async (req, res) => {
    const { name } = req.params;
    try {
        const db = await readDb();
        const scheduleData = db.profiles[db.activeProfile]?.schedules[name];
        if (scheduleData) {
            res.json(scheduleData);
        } else {
            res.status(404).json({ message: '找不到班表' });
        }
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST new schedule
app.post('/api/schedules', async (req, res) => {
    const { name, data } = req.body;
    if (!name || !data) return res.status(400).json({ message: '缺少名稱或內容' });
    try {
        const db = await readDb();
        db.profiles[db.activeProfile].schedules[name] = data;
        await writeDb(db);
        res.status(201).json({ message: '班表已儲存' });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// DELETE schedule
app.delete('/api/schedules/:name', async (req, res) => {
    const { name } = req.params;
    try {
        const db = await readDb();
        if (db.profiles[db.activeProfile]?.schedules[name]) {
            delete db.profiles[db.activeProfile].schedules[name];
            await writeDb(db);
            res.status(200).json({ message: '班表已刪除' });
        } else {
            res.status(404).json({ message: '找不到要刪除的班表' });
        }
    } catch (e) { res.status(500).json({ message: e.message }); }
});


// --- Fallback to serve index.html ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, async () => {
    await loadHolidays(); // Pre-cache holidays on startup
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});

