// --- 模組引入 ---
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
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
const iconv = require('iconv-lite');

// 學校行事曆快取（6小時）
let schoolEventsCache = { data: null, fetchedAt: 0 };

// 自動計算當前學期代碼（民國年+學期，例：1142）
function getCurrentPeriod() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const rocYear = now.getFullYear() - 1911;
    if (month >= 8) return `${rocYear}1`;
    if (month === 1) return `${rocYear - 1}1`;
    return `${rocYear - 1}2`;
}

// 以 Big5 解碼抓取網頁
async function fetchBig5(url) {
    const resp = await fetch(url);
    const buffer = await resp.arrayBuffer();
    return iconv.decode(Buffer.from(buffer), 'big5');
}

// --- 常數設定 ---
const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'scheduleApp';
const CONFIG_ID = 'main_config';

// --- 安全性設定 ---
// 安全的 Profile 名稱格式：字母、數字、中文、底線、連字號，1-50 字符
const SAFE_PROFILE_NAME_REGEX = /^[a-zA-Z0-9_\u4e00-\u9fa5-]{1,50}$/;
// 安全的班表名稱格式
const SAFE_SCHEDULE_NAME_REGEX = /^[a-zA-Z0-9_\u4e00-\u9fa5-]{1,100}$/; 

// --- 資料庫客戶端設定 ---
let client;
let db;
let configCollection;
let holidaysCollection;
let usersCollection = null; // accounting_db.users（共用帳號）
let isDbConnected = false;

if (MONGODB_URI) {
    client = new MongoClient(MONGODB_URI, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        },
        // 增加連線逾時設定,處理網路問題
        connectTimeoutMS: 30000,
        socketTimeoutMS: 30000,
        // 增加重試設定
        retryWrites: true,
        retryReads: true,
        maxPoolSize: 10,
        minPoolSize: 2
    });
} else {
    debugServer('警告: 未提供 MONGODB_URI 環境變數。資料庫功能將被禁用。');
}

// --- 中介軟體設定 ---
// 信任代理設定 (必須在 rate limiter 之前設定)
// 當應用程式部署在反向代理(如 Zeabur)後面時需要此設定
app.set('trust proxy', 1);

const corsOptions = {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- 速率限制（分層）---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: '登入嘗試次數過多，請於 15 分鐘後再試。'
});

const readLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: '來自此 IP 的請求過多，請於 15 分鐘後再試。'
});

const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: '來自此 IP 的請求過多，請於 15 分鐘後再試。'
});

const generateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: '產生班表次數過多，請於 15 分鐘後再試。'
});

// 依 HTTP 方法套用速率限制（auth 路由例外，由 authLimiter 單獨處理）
app.use('/api/', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    if (req.method === 'GET') return readLimiter(req, res, next);
    return writeLimiter(req, res, next);
});

// --- 身份驗證中介軟體 ---
function requireAuth(req, res, next) {
    if (!process.env.JWT_SECRET) return next(); // 未設定 JWT_SECRET → 直接通過
    if (req.path.startsWith('/auth/')) return next(); // 跳過登入路由
    if (req.path === '/status' && req.method === 'GET') return next(); // 健康檢查不需登入

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: '請先登入' });
    }
    const token = authHeader.slice(7);
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        next();
    } catch {
        return res.status(401).json({ message: '登入已過期，請重新登入' });
    }
}

app.use('/api/', requireAuth);

// --- 安全輔助函式 ---
const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const validateProfileName = (name) => {
    if (!name || typeof name !== 'string') {
        return { valid: false, error: 'Profile 名稱必須是字串' };
    }
    if (!SAFE_PROFILE_NAME_REGEX.test(name)) {
        return { valid: false, error: 'Profile 名稱格式不正確（僅允許字母、數字、中文、底線、連字號，1-50 字符）' };
    }
    return { valid: true };
};

const validateScheduleName = (name) => {
    if (!name || typeof name !== 'string') {
        return { valid: false, error: '班表名稱必須是字串' };
    }
    if (!SAFE_SCHEDULE_NAME_REGEX.test(name)) {
        return { valid: false, error: '班表名稱格式不正確（僅允許字母、數字、中文、底線、連字號，1-100 字符）' };
    }
    return { valid: true };
};

const validateSettings = (settings) => {
    if (!settings || typeof settings !== 'object') {
        return { valid: false, error: 'Settings 必須是對象' };
    }
    if (!Array.isArray(settings.tasks)) {
        return { valid: false, error: 'tasks 必須是數組' };
    }
    if (!Array.isArray(settings.personnel)) {
        return { valid: false, error: 'personnel 必須是數組' };
    }

    // 驗證每個 task
    for (let i = 0; i < settings.tasks.length; i++) {
        const task = settings.tasks[i];
        if (!task.name || typeof task.name !== 'string' || task.name.length > 100) {
            return { valid: false, error: `Task ${i} 名稱無效` };
        }
        if (typeof task.count !== 'number' || task.count < 1 || task.count > 50) {
            return { valid: false, error: `Task ${i} 人數必須在 1-50 之間` };
        }
        if (task.priority !== undefined && (typeof task.priority !== 'number' || !Number.isInteger(task.priority) || task.priority < 1 || task.priority > 9)) {
            return { valid: false, error: `Task ${i} 優先級必須是 1-9 的整數` };
        }
    }

    // 驗證每個 personnel
    for (let i = 0; i < settings.personnel.length; i++) {
        const person = settings.personnel[i];
        if (!person.name || typeof person.name !== 'string' || person.name.length > 50) {
            return { valid: false, error: `Personnel ${i} 名稱無效` };
        }
        if (person.maxShifts !== undefined && (typeof person.maxShifts !== 'number' || person.maxShifts < 1 || person.maxShifts > 7)) {
            return { valid: false, error: `Personnel ${i} maxShifts 必須在 1-7 之間` };
        }
        if (person.offDays !== undefined && !Array.isArray(person.offDays)) {
            return { valid: false, error: `Personnel ${i} offDays 必須是數組` };
        }
        if (person.offDays && !person.offDays.every(d => Number.isInteger(d) && d >= 0 && d <= 4)) {
            return { valid: false, error: `人員 ${i + 1} 的 offDays 只能包含 0-4 的整數（代表週一到週五）` };
        }
        if (person.taskScores !== undefined) {
            if (typeof person.taskScores !== 'object' || person.taskScores === null || Array.isArray(person.taskScores)) {
                return { valid: false, error: `Personnel ${i} taskScores 必須是物件` };
            }
            for (const [taskName, score] of Object.entries(person.taskScores)) {
                if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 5) {
                    return { valid: false, error: `Personnel ${i} 的 taskScores["${taskName}"] 必須是 0-5 的整數` };
                }
            }
        }
    }

    return { valid: true };
};

// --- 密碼 PBKDF2-SHA256（相容 passlib 格式）---
// 格式：$pbkdf2-sha256$<rounds>$<ab64_salt>$<ab64_hash>
// ab64 = 標準 base64，但 '+' 換成 '.'，無 '=' padding
const ab64decode = s => {
    s = s.replace(/\./g, '+');
    while (s.length % 4) s += '=';
    return Buffer.from(s, 'base64');
};
const ab64encode = buf => buf.toString('base64').replace(/\+/g, '.').replace(/=/g, '');

function verifyPasslibPbkdf2(password, storedHash) {
    try {
        const parts = storedHash.split('$');
        if (parts.length < 5 || parts[1] !== 'pbkdf2-sha256') return false;
        const rounds = parseInt(parts[2]);
        const salt = ab64decode(parts[3]);
        const expected = ab64decode(parts[4]);
        const derived = crypto.pbkdf2Sync(password, salt, rounds, expected.length, 'sha256');
        return crypto.timingSafeEqual(derived, expected);
    } catch { return false; }
}

function hashPasslibPbkdf2(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(password, salt, 29000, 32, 'sha256');
    return `$pbkdf2-sha256$29000$${ab64encode(salt)}$${ab64encode(hash)}`;
}

// --- Email（忘記密碼）---
function createMailTransporter() {
    if (!process.env.SMTP_USERNAME || !process.env.SMTP_PASSWORD) return null;
    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD },
    });
}

async function sendResetEmail(toEmail, resetUrl) {
    const transporter = createMailTransporter();
    if (!transporter) { debugServer('SMTP 未設定，無法寄送密碼重設信'); return false; }
    const fromName = process.env.SMTP_FROM_NAME || '排班系統 - 系統通知';
    try {
        await transporter.sendMail({
            from: `"${fromName}" <${process.env.SMTP_USERNAME}>`,
            to: toEmail,
            subject: '排班系統 — 密碼重設',
            html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
                <h2 style="color:#0284c7;">密碼重設</h2>
                <p>我們收到了您的密碼重設請求。請點擊下方按鈕重設密碼：</p>
                <a href="${resetUrl}"
                   style="display:inline-block;padding:12px 24px;background:#0284c7;color:#fff;
                          border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
                    重設密碼
                </a>
                <p style="color:#6b7280;font-size:0.875rem;">
                    此連結將在 1 小時後失效。若非您本人操作，請忽略此信件。
                </p>
            </div>`,
        });
        debugServer(`密碼重設信已寄送至: ${toEmail}`);
        return true;
    } catch (e) {
        debugServer('寄送密碼重設信失敗:', e.message);
        return false;
    }
}

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
    const cacheKey = year;
    if (holidaysCache.has(cacheKey)) {
        debugDb(`從快取為 ${year} 年讀取假日資料。`);
        return holidaysCache.get(cacheKey);
    }

    if (!isDbConnected) return new Map();

    // 1. 先查 MongoDB
    try {
        const yearStr = String(year);
        debugDb(`從資料庫讀取 ${year} 年的假日資料...`);
        const holidays = await holidaysCollection.find({ _id: { $regex: `^${yearStr}` }, isHoliday: true }).toArray();

        if (holidays.length > 0) {
            const holidayMap = new Map();
            holidays.forEach(h => holidayMap.set(h._id, h.name));
            holidaysCache.set(cacheKey, holidayMap);
            debugDb(`已快取 ${year} 年的 ${holidayMap.size} 個假日項目。`);
            return holidayMap;
        }
    } catch (error) {
        debugDb(`讀取 ${year} 年假日資料失敗:`, error);
        return new Map();
    }

    // 2. MongoDB 無資料 → 從 CDN 抓取
    try {
        debugDb(`MongoDB 無 ${year} 年假日資料，從 CDN 抓取...`);
        const resp = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`);
        if (resp.ok) {
            const data = await resp.json();
            const docs = data.map(h => ({ _id: h.date, name: h.description || '國定假日', isHoliday: h.isHoliday }));
            await holidaysCollection.insertMany(docs, { ordered: false }).catch(() => {});
            const holidayMap = new Map();
            data.filter(h => h.isHoliday).forEach(h => holidayMap.set(h.date, h.description || '國定假日'));
            holidaysCache.set(cacheKey, holidayMap);
            debugDb(`已從 CDN 取得並快取 ${year} 年假日資料（${holidayMap.size} 個假日）。`);
            return holidayMap;
        }
    } catch (e) {
        debugDb(`CDN 抓取 ${year} 年假日資料失敗:`, e.message);
    }

    return new Map();
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

        // 檢查 holidays 目錄是否存在
        try {
            await fs.access(holidayDir);
        } catch (err) {
            debugServer('警告: holidays 目錄不存在，跳過假日資料植入。');
            return;
        }

        const files = await fs.readdir(holidayDir);
        const jsonFiles = files.filter(file => file.endsWith('.json'));

        if (jsonFiles.length === 0) {
            debugServer('警告: holidays 目錄中沒有找到 JSON 檔案。');
            return;
        }

        const documents = [];

        for (const file of jsonFiles) {
            const filePath = path.join(holidayDir, file);
            debugDb(`讀取假日檔案: ${filePath}`);
            const data = await fs.readFile(filePath, 'utf-8');
            const holidayData = JSON.parse(data);

            holidayData.forEach(h => {
                if (h.isHoliday && h.date) {
                    documents.push({
                        _id: h.date,
                        name: h.description || h.name || '國定假日',
                        isHoliday: true,
                    });
                }
            });
        }

        if (documents.length > 0) {
            try {
                const result = await holidaysCollection.insertMany(documents, { ordered: false });
                debugDb(`共植入 ${result.insertedCount} 筆初始假日資料。`);
            } catch (err) {
                if (err.code === 11000) { // Handle duplicate key error gracefully
                    const insertedCount = err.result?.nInserted || err.insertedCount || 0;
                    debugDb(`部分假日資料已存在，略過重複部分。共新增 ${insertedCount} 筆資料。`);
                } else {
                    throw err; // Re-throw other errors
                }
            }
        } else {
            debugServer('警告: 沒有找到有效的假日資料。');
        }
    } catch (error) {
        debugServer('植入初始假日資料時發生錯誤:', error);
        debugServer('錯誤詳情:', error.stack);
    }
};


// [預留功能] 技能分數系統 — 目前 UI 尚未提供輸入介面，邏輯保留供日後啟用
// 計算人員對特定班次的有效技能分 (0-5)
// 優先使用 taskScores，否則從 preferredTask 推算（向下兼容）
const getEffectiveScore = (person, taskName) => {
    if (person.taskScores && typeof person.taskScores === 'object') {
        const score = person.taskScores[taskName];
        if (typeof score === 'number') return score;
        return 1; // taskScores 存在但無此班次的條目 → 低分
    }
    if (!person.preferredTask) return 3;             // 無偏好 → 中性
    if (person.preferredTask === taskName) return 4; // 偏好此班次
    return 2;                                        // 偏好其他班次
};

const generateWeeklySchedule = (settings, scheduleDays, cumulativeShifts = new Map()) => {
    const { personnel, tasks } = settings;
    const weeklySchedule = Array(5).fill(null).map(() => Array(tasks.length).fill(null).map(() => []));
    const shiftCounts = new Map(personnel.map(p => [p.name, 0]));
    // 每天已分配的人（同一天不重複排）
    const dailyAssigned = new Map(
        scheduleDays.map((_, i) => [i, new Set()])
    );

    const workDays = [0, 1, 2, 3, 4].filter(i => scheduleDays[i].shouldSchedule);

    // 任務依優先級排序（數字小 = 優先級高，未設定視為 9）
    const tasksByPriority = tasks
        .map((t, i) => ({ ...t, taskIndex: i }))
        .sort((a, b) => (a.priority || 9) - (b.priority || 9));

    // 建立 slot 清單：高優先級的所有 slot 排在前面
    // 同一任務內，以「每天各輪一次」的方式交替，確保每天都有機會被填
    const slots = [];
    for (const { taskIndex, count } of tasksByPriority) {
        // 每輪（slotIndex）隨機打亂天的順序，確保不偏向固定某天
        for (let slotIndex = 0; slotIndex < count; slotIndex++) {
            const shuffledDays = [...workDays].sort(() => Math.random() - 0.5);
            for (const dayIndex of shuffledDays) {
                slots.push({ dayIndex, taskIndex });
            }
        }
    }

    // 逐一填補每個 slot
    for (const { dayIndex, taskIndex } of slots) {
        const task = tasks[taskIndex];
        const assigned = dailyAssigned.get(dayIndex);

        // 可用人員：未超班次上限、非休假、今天尚未被排
        const available = personnel.filter(p =>
            !p.offDays?.includes(dayIndex) &&
            (shiftCounts.get(p.name) || 0) < (p.maxShifts || 5) &&
            !assigned.has(p.name)
        );
        if (available.length === 0) continue;

        // 排序：跨週累積最少 → 本週已排最少 → 技能分 + 隨機
        available.sort((a, b) => {
            const cumDiff = (cumulativeShifts.get(a.name) || 0) - (cumulativeShifts.get(b.name) || 0);
            if (cumDiff !== 0) return cumDiff;
            const usedDiff = (shiftCounts.get(a.name) || 0) - (shiftCounts.get(b.name) || 0);
            if (usedDiff !== 0) return usedDiff;
            const scoreA = getEffectiveScore(a, task.name) / 5 * 0.6 + Math.random() * 0.4;
            const scoreB = getEffectiveScore(b, task.name) / 5 * 0.6 + Math.random() * 0.4;
            return scoreB - scoreA;
        });

        const person = available[0];
        weeklySchedule[dayIndex][taskIndex].push(person.name);
        shiftCounts.set(person.name, (shiftCounts.get(person.name) || 0) + 1);
        assigned.add(person.name);
    }

    // 計算每個任務的填補率，方便診斷
    const fillStats = tasks.map((task, taskIndex) => {
        const needed = workDays.length * (task.count || 1);
        const filled = workDays.reduce((sum, dayIndex) => sum + weeklySchedule[dayIndex][taskIndex].length, 0);
        return { name: task.name, priority: task.priority || 9, needed, filled, ok: filled === needed };
    });

    const unfilled = fillStats.filter(s => !s.ok);
    if (unfilled.length > 0) {
        debugSchedule('未填滿的勤務:', unfilled.map(s => `${s.name}(優先${s.priority}) ${s.filled}/${s.needed}`).join(', '));
        debugSchedule('人員班次分佈:', Object.fromEntries(shiftCounts));
    }

    return { weeklySchedule, fillStats, weekShiftCounts: shiftCounts };
};

const generateScheduleHtml = (fullScheduleData) => {
    // 加入 A4 直式版面的 CSS
    let html = `
<style>
@media print {
    @page {
        size: A4 portrait;
        margin: 10mm;
    }
    body {
        width: 210mm;
        min-height: 297mm;
    }
}
</style>
`;

    fullScheduleData.forEach((data, index) => {
        const { schedule, tasks, dateRange, weekDayDates, scheduleDays, color } = data;
        const weekDayNames = ['一', '二', '三', '四', '五'];
        // 驗證並清理顏色值（防止 CSS 注入）
        const safeHeaderColor = /^#[0-9a-fA-F]{6}$/.test(color.header) ? color.header : '#0284c7';
        const headerStyle = `style="background-color: ${safeHeaderColor}; color: white;"`;

        html += `
            <div class="mb-8" id="schedule-week-${index}">
                <h3 class="text-xl font-bold mb-2">第 ${index + 1} 週班表 (${escapeHtml(dateRange)})</h3>
                <table class="schedule-table">
                    <thead>
                        <tr>
                            <th ${headerStyle}>勤務地點</th>
                            ${weekDayDates.map((date, i) => `<th ${headerStyle}>星期${weekDayNames[i]}<br>(${escapeHtml(date)})</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${tasks.map((task, taskIndex) => {
                            // 計算這個任務在整週中最多有幾位員工（決定需要幾列）
                            const maxPersonnel = Math.max(
                                ...weekDayDates.map((_, dayIndex) =>
                                    scheduleDays[dayIndex].shouldSchedule
                                        ? schedule[dayIndex][taskIndex].length
                                        : 0
                                ),
                                1 // 至少一列
                            );

                            // 為每位員工生成一個獨立的 <tr>
                            let taskRows = '';
                            for (let personIndex = 0; personIndex < maxPersonnel; personIndex++) {
                                taskRows += '<tr>';

                                // 第一列顯示任務名稱（使用 rowspan 跨越所有員工列）
                                if (personIndex === 0) {
                                    taskRows += `<td class="font-medium align-middle" rowspan="${maxPersonnel}">${escapeHtml(task.name)}</td>`;
                                }

                                // 為每一天生成 <td>，每個儲存格只顯示一位員工
                                weekDayDates.forEach((_, dayIndex) => {
                                    if (!scheduleDays[dayIndex].shouldSchedule) {
                                        // 假日：只在第一列顯示（使用 rowspan）
                                        if (personIndex === 0) {
                                            taskRows += `<td class="holiday-cell align-middle" rowspan="${maxPersonnel}">${escapeHtml(scheduleDays[dayIndex].description)}</td>`;
                                        }
                                    } else {
                                        // 正常日：顯示這位員工的姓名（一個儲存格只有一個人）
                                        const personnel = schedule[dayIndex][taskIndex];
                                        const personName = personnel[personIndex] || '';
                                        taskRows += `<td class="align-middle">${escapeHtml(personName)}</td>`;
                                    }
                                });

                                taskRows += '</tr>';
                            }
                            return taskRows;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    });
    return html;
};

// --- 身份驗證路由（原生實作，共用 accounting_db.users）---
app.post('/api/auth/login', authLimiter, async (req, res) => {
    if (!usersCollection) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'Email 和密碼不能為空' });

        const user = await usersCollection.findOne({ email: email.trim().toLowerCase() });
        if (!user || !user.is_active) return res.status(401).json({ message: 'Email 或密碼錯誤' });

        if (!verifyPasslibPbkdf2(password, user.password_hash))
            return res.status(401).json({ message: 'Email 或密碼錯誤' });

        await usersCollection.updateOne({ _id: user._id }, { $set: { last_login: new Date() } });

        if (!process.env.JWT_SECRET) return res.status(500).json({ message: 'JWT_SECRET 未設定' });

        const token = jwt.sign(
            { user_id: String(user._id), email: user.email, name: user.name || '', type: 'access' },
            process.env.JWT_SECRET,
            { algorithm: 'HS256', expiresIn: '7d' }
        );
        debugServer(`用戶登入: ${user.email}`);
        res.json({ token, user: { id: String(user._id), email: user.email, name: user.name || '' } });
    } catch (e) {
        debugServer('登入失敗:', e);
        res.status(500).json({ message: '登入失敗，請稍後再試' });
    }
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: '請提供 Email' });

        if (usersCollection) {
            const user = await usersCollection.findOne({ email: email.trim().toLowerCase() });
            if (user) {
                const token = crypto.randomBytes(32).toString('hex');
                const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 小時
                await usersCollection.updateOne(
                    { _id: user._id },
                    { $set: { password_reset_token: token, password_reset_expires: expires } }
                );
                const origin = req.headers.origin || `http://localhost:${PORT}`;
                const resetUrl = `${origin}?reset_token=${token}`;
                const sent = await sendResetEmail(user.email, resetUrl);
                if (!sent) return res.status(500).json({ message: '郵件服務未設定或發送失敗，請聯繫管理員' });
                debugServer(`密碼重設信已寄送: ${user.email}`);
            }
        }
        // 無論 email 存不存在都回 200（防帳號列舉）
        res.json({ message: '若此 Email 已註冊，重設連結已寄出' });
    } catch (e) {
        debugServer('忘記密碼失敗:', e);
        res.status(500).json({ message: '系統錯誤' });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    if (!usersCollection) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { token, new_password } = req.body;
        if (!token || !new_password) return res.status(400).json({ message: '請提供 token 和新密碼' });

        const user = await usersCollection.findOne({ password_reset_token: token });
        if (!user) return res.status(400).json({ message: '連結無效或已過期' });

        const expires = user.password_reset_expires;
        if (!expires || new Date() > new Date(expires))
            return res.status(400).json({ message: '連結已過期，請重新申請' });

        const newHash = hashPasslibPbkdf2(new_password);
        await usersCollection.updateOne(
            { _id: user._id },
            {
                $set: { password_hash: newHash, password_last_updated: new Date() },
                $unset: { password_reset_token: '', password_reset_expires: '' },
            }
        );
        debugServer(`用戶已重設密碼: ${user.email}`);
        res.json({ message: '密碼已重設，請重新登入' });
    } catch (e) {
        debugServer('重設密碼失敗:', e);
        res.status(500).json({ message: '系統錯誤' });
    }
});

app.post('/api/auth/logout', (req, res) => res.json({ message: '已登出' }));

// --- API 路由 ---
app.get('/api/status', async (req, res) => {
    const status = {
        server: 'running',
        database: isDbConnected ? 'connected' : 'disconnected'
    };

    if (isDbConnected) {
        try {
            const holidayCount = await holidaysCollection.countDocuments();
            const profileCount = await configCollection.countDocuments();
            status.holidaysCount = holidayCount;
            status.profilesCount = profileCount;
            status.cacheSize = holidaysCache.size;
        } catch (error) {
            status.dbError = error.message;
        }
    }

    res.json(status);
});

// --- Holiday API Routes ---
app.get('/api/holidays/:year', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { year } = req.params;
        const holidays = await holidaysCollection.find({ _id: { $regex: `^${year}` }, isHoliday: true }).toArray();
        res.json(holidays.map(h => ({ date: h._id, name: h.name })));
    } catch(error) {
        debugDb('讀取年度假日失敗:', error);
        res.status(500).json({ message: '讀取年度假日失敗' });
    }
});

app.post('/api/holidays/reseed', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        debugDb('手動觸發假日資料重新植入...');

        // 清空現有假日資料
        const deleteResult = await holidaysCollection.deleteMany({});
        debugDb(`已刪除 ${deleteResult.deletedCount} 筆舊假日資料。`);

        // 清空快取
        holidaysCache.clear();

        // 重新植入
        await seedHolidays();

        // 確認植入結果
        const count = await holidaysCollection.countDocuments();
        res.json({
            message: '假日資料重新植入完成',
            count: count
        });
    } catch(error) {
        debugDb('重新植入假日資料失敗:', error);
        res.status(500).json({ message: '重新植入假日資料失敗', error: error.message });
    }
});

app.put('/api/holidays', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const { date, name, isHoliday } = req.body;
        if (!date) return res.status(400).json({ message: '日期為必填欄位' });
        
        const year = parseInt(date.substring(0, 4));
        holidaysCache.delete(year);

        const filter = { _id: date };

        if (isHoliday) {
            const update = { $set: { name, isHoliday: true } };
            await holidaysCollection.updateOne(filter, update, { upsert: true });
        } else {
            await holidaysCollection.deleteOne(filter);
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

    // 禁用快取，確保每次都取得最新資料
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

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

// --- 學校行事曆 API ---
app.get('/api/school-events', async (req, res) => {
    const CACHE_TTL = 6 * 60 * 60 * 1000; // 6小時
    if (schoolEventsCache.data && Date.now() - schoolEventsCache.fetchedAt < CACHE_TTL) {
        return res.json(schoolEventsCache.data);
    }

    try {
        const BASE = 'https://s44.mingdao.edu.tw/AACourses/Web/';
        const period = getCurrentPeriod();

        // 抓主頁面，找所有「重要考試」日期
        const mainHtml = await fetchBig5(`${BASE}eCalendar_view.php`);

        // 從 div 標籤萃取有「重要考試」的 qDate
        const examDates = new Set();
        const divTagRegex = /<div[^>]+id="sDB_[^"]*"[^>]*>/g;
        let tagMatch;
        while ((tagMatch = divTagRegex.exec(mainHtml)) !== null) {
            const tag = tagMatch[0];
            if (!tag.includes('重要考試')) continue;
            const qDateMatch = tag.match(/qDate="([^"]+)"/);
            if (qDateMatch) examDates.add(qDateMatch[1]);
        }

        // 逐日查詢詳細事件，找定期評量／期中考
        const seen = new Set();
        const events = [];

        for (const qDate of examDates) {
            const encoded = encodeURIComponent(qDate);
            const html = await fetchBig5(`${BASE}eCalendar_list.php?F_sPeriod=${period}&qDate=${encoded}&qDG=&qSpec=`);

            const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/g;
            let liMatch;
            while ((liMatch = liRegex.exec(html)) !== null) {
                const text = liMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                if ((text.includes('定期評量') || text.includes('期中考')) && !seen.has(text)) {
                    seen.add(text);
                    // 解析日期範圍（e.g. "03/25~26 重要考試 說明"）
                    const rangeMatch = text.match(/^(\d{2})\/(\d{2})(?:~(\d{2}))?/);
                    const nameMatch = text.match(/重要考試\s+(.+)$/);
                    if (rangeMatch) {
                        const year = new Date().getFullYear();
                        const startDate = `${year}${rangeMatch[1]}${rangeMatch[2]}`;
                        const endDate = rangeMatch[3]
                            ? `${year}${rangeMatch[1]}${rangeMatch[3]}`
                            : startDate;
                        const fullName = nameMatch ? nameMatch[1].trim() : text;
                        const ordinalMatch = fullName.match(/第([一二三四五六七八九十]+)次/);
                        const shortName = ordinalMatch
                            ? `第${ordinalMatch[1]}次定期評量`
                            : fullName;
                        events.push({
                            startDate,
                            endDate,
                            name: shortName,
                            type: 'exam'
                        });
                    }
                }
            }
        }

        schoolEventsCache = { data: events, fetchedAt: Date.now() };
        res.json(events);
    } catch (e) {
        debugServer('抓取學校行事曆失敗:', e);
        res.status(500).json({ message: '無法取得學校行事曆：' + e.message });
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

        // 驗證 Profile 名稱
        const validation = validateProfileName(name);
        if (!validation.valid) {
            return res.status(400).json({ message: validation.error });
        }

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

        // 解碼 URL 編碼的名稱（處理中文等特殊字元）
        const decodedName = decodeURIComponent(name);

        // 驗證 Profile 名稱
        const nameValidation = validateProfileName(decodedName);
        if (!nameValidation.valid) {
            return res.status(400).json({ message: nameValidation.error });
        }

        // 驗證 Settings
        const settingsValidation = validateSettings(settings);
        if (!settingsValidation.valid) {
            return res.status(400).json({ message: settingsValidation.error });
        }

        // 驗證設定檔是否存在
        const config = await configCollection.findOne({ _id: CONFIG_ID });
        if (!config || !config.profiles || !config.profiles[decodedName]) {
            debugDb(`設定檔 "${decodedName}" 不存在`);
            return res.status(404).json({ message: `找不到設定檔: ${decodedName}` });
        }

        // 更新設定
        const result = await configCollection.updateOne(
            { _id: CONFIG_ID },
            { $set: { [`profiles.${decodedName}.settings`]: settings } }
        );

        if (result.modifiedCount === 0) {
            debugDb(`設定檔 "${decodedName}" 無需更新（資料相同）`);
        } else {
            debugDb(`設定檔 "${decodedName}" 已成功更新`);
        }

        res.json({ message: `設定檔 ${decodedName} 已更新` });
    } catch (error) {
        debugDb('更新設定檔失敗:', error);
        // 不洩露堆棧跟踪到客戶端
        res.status(500).json({ message: '更新設定檔時發生錯誤' });
    }
});

app.put('/api/profiles/:name/rename', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const oldName = decodeURIComponent(req.params.name);
        const { newName } = req.body;

        // 驗證兩個名稱
        const oldNameValidation = validateProfileName(oldName);
        if (!oldNameValidation.valid) {
            return res.status(400).json({ message: '舊名稱無效: ' + oldNameValidation.error });
        }
        const newNameValidation = validateProfileName(newName);
        if (!newNameValidation.valid) {
            return res.status(400).json({ message: '新名稱無效: ' + newNameValidation.error });
        }

        const config = await configCollection.findOne({ _id: CONFIG_ID });
        if (!config.profiles[oldName] || config.profiles[newName]) {
            return res.status(400).json({ message: '無效的名稱或新名稱已存在' });
        }
        let update = { $rename: { [`profiles.${oldName}`]: `profiles.${newName}` } };
        if (config.activeProfile === oldName) {
            update.$set = { activeProfile: newName };
        }
        await configCollection.updateOne({ _id: CONFIG_ID }, update);
        debugDb(`設定檔已重新命名: "${oldName}" → "${newName}"`);
        res.json({ message: '設定檔已重新命名' });
    } catch (error) {
        debugDb('重新命名設定檔失敗:', error);
        res.status(500).json({ message: '重新命名設定檔時發生錯誤' });
    }
});

app.delete('/api/profiles/:name', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const nameToDelete = decodeURIComponent(req.params.name);

        // 驗證 Profile 名稱
        const validation = validateProfileName(nameToDelete);
        if (!validation.valid) {
            return res.status(400).json({ message: validation.error });
        }

        const config = await configCollection.findOne({ _id: CONFIG_ID });
        const profileKeys = Object.keys(config.profiles);
        if (profileKeys.length <= 1) return res.status(400).json({ message: '無法刪除最後一個設定檔' });
        let update = { $unset: { [`profiles.${nameToDelete}`]: "" } };
        if (config.activeProfile === nameToDelete) {
            const newActiveProfile = profileKeys.find(key => key !== nameToDelete);
            update.$set = { activeProfile: newActiveProfile };
        }
        await configCollection.updateOne({ _id: CONFIG_ID }, update);
        debugDb(`設定檔已刪除: "${nameToDelete}"`);
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

        // 驗證班表名稱
        const validation = validateScheduleName(name);
        if (!validation.valid) {
            return res.status(400).json({ message: validation.error });
        }

        // 驗證班表數據結構
        if (!Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ message: '班表數據必須是非空數組' });
        }

        // 使用原子操作避免競態條件
        // 直接在更新時獲取 activeProfile，而不是分兩步
        const config = await configCollection.findOne({ _id: CONFIG_ID }, { projection: { activeProfile: 1 } });
        if (!config || !config.activeProfile) {
            return res.status(500).json({ message: '無法獲取作用中的設定檔' });
        }

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

app.get('/api/schedules/:name', async (req, res) => {
    if (!isDbConnected) return res.status(503).json({ message: '資料庫未連線' });
    try {
        const name = decodeURIComponent(req.params.name);

        // 驗證班表名稱
        const validation = validateScheduleName(name);
        if (!validation.valid) {
            return res.status(400).json({ message: validation.error });
        }

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
        const name = decodeURIComponent(req.params.name);

        // 驗證班表名稱
        const validation = validateScheduleName(name);
        if (!validation.valid) {
            return res.status(400).json({ message: validation.error });
        }

        const config = await configCollection.findOne({ _id: CONFIG_ID }, { projection: { activeProfile: 1 } });
        const activeProfile = config.activeProfile;
        const result = await configCollection.updateOne({ _id: CONFIG_ID }, { $unset: { [`profiles.${activeProfile}.schedules.${name}`]: "" } });
        if (result.modifiedCount === 0) throw new Error('刪除班表失敗');
        debugDb(`班表已刪除: "${name}"`);
        res.json({ message: '班表已刪除' });
    } catch (error) {
        debugDb('刪除班表失敗:', error);
        res.status(500).json({ message: '刪除班表時發生錯誤' });
    }
});

app.post('/api/generate-schedule', generateLimiter, async (req, res) => {
    try {
        const { settings, startWeek, numWeeks, activeHolidays } = req.body;

        const validation = validateSettings(settings);
        if (!validation.valid) {
            return res.status(400).json({ message: validation.error });
        }

        if (!Number.isInteger(numWeeks) || numWeeks < 1 || numWeeks > 52) {
            return res.status(400).json({ message: 'numWeeks 必須是 1-52 的整數' });
        }
        const numWeeksInt = numWeeks;

        const fullScheduleData = [];
        const colors = [ { header: '#0284c7', row: '#f0f9ff' }, { header: '#15803d', row: '#f0fdf4' }, { header: '#be185d', row: '#fdf2f8' }, { header: '#86198f', row: '#faf5ff' } ];
        const cumulativeShifts = new Map();
        for (let i = 0; i < numWeeksInt; i++) {
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
            const { weeklySchedule, fillStats, weekShiftCounts } = generateWeeklySchedule(settings, scheduleDays, cumulativeShifts);
            for (const [name, count] of weekShiftCounts) {
                cumulativeShifts.set(name, (cumulativeShifts.get(name) || 0) + count);
            }
            fullScheduleData.push({ schedule: weeklySchedule, fillStats, tasks: settings.tasks, dateRange: `${weekDayDates[0]} - ${weekDayDates[4]}`, weekDayDates, scheduleDays, color: colors[i % colors.length] });
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

// Favicon 路由 - 防止 404 錯誤
app.get('/favicon.ico', (req, res) => {
    res.status(204).end(); // 204 No Content
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
        usersCollection = client.db('accounting_db').collection('users');
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

        // 提供更詳細的錯誤訊息
        if (err.code === 8000) {
            console.error('\n⚠️  MongoDB Atlas 錯誤 (code: 8000)');

            // 檢查是否為儲存空間配額問題
            if (err.errmsg && err.errmsg.includes('space quota')) {
                console.error('🚨 儲存空間配額已用盡!');
                console.error('錯誤訊息:', err.errmsg);
                console.error('\n解決方案:');
                console.error('1. 登入 MongoDB Atlas (https://cloud.mongodb.com)');
                console.error('2. 刪除不需要的資料或集合以釋放空間');
                console.error('3. 或升級到付費方案以獲得更多儲存空間');
                console.error('4. 或建立新的免費叢集 (每個帳號可建立一個免費叢集)\n');
            } else {
                console.error('可能的原因:');
                console.error('1. 資料庫認證失敗 - 請檢查 MONGODB_URI 中的使用者名稱和密碼');
                console.error('2. IP 白名單限制 - 請在 MongoDB Atlas 中將此伺服器的 IP 位址加入白名單');
                console.error('3. 資料庫存取權限不足 - 請確認使用者具有正確的資料庫權限');
                console.error('4. 網路連線問題 - 請檢查網路連線是否正常\n');
            }
        } else if (err.name === 'MongoNetworkError') {
            console.error('\n⚠️  MongoDB 網路連線錯誤');
            console.error('請檢查:');
            console.error('1. 網路連線是否正常');
            console.error('2. MongoDB URI 格式是否正確');
            console.error('3. 防火牆設定是否允許連線\n');
        } else if (err.name === 'MongoServerError') {
            console.error('\n⚠️  MongoDB 伺服器錯誤');
            console.error('錯誤訊息:', err.message);
            console.error('錯誤代碼:', err.code, '\n');
        }

        isDbConnected = false;
        debugServer('伺服器啟動失敗: %O', err);
        app.listen(PORT, () => {
            debugServer(`伺服器正在 http://localhost:${PORT} 上運行 (資料庫連線失敗)`);
        });
    }
};

// 測試環境下的數據庫初始化函數
const initTestDb = async () => {
    if (process.env.NODE_ENV === 'test' && MONGODB_URI) {
        try {
            await client.connect();
            db = client.db(DB_NAME);
            configCollection = db.collection('profiles');
            holidaysCollection = db.collection('holidays');
            usersCollection = client.db('accounting_db').collection('users');
            isDbConnected = true;
            await ensureConfigDocument();
            await seedHolidays();
            debugDb('測試環境資料庫已初始化');
        } catch (err) {
            debugDb('測試環境資料庫初始化失敗: %O', err);
            isDbConnected = false;
        }
    }
};

// 導出 app 和輔助函數供測試使用
module.exports = app;
module.exports.initTestDb = initTestDb;

// 僅在非測試環境下自動啟動伺服器
if (process.env.NODE_ENV !== 'test') {
    startServer();

    process.on('SIGINT', async () => {
        debugServer('收到 SIGINT。正在關閉連線...');
        if (client) {
            await client.close();
        }
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        debugServer('收到 SIGTERM。正在關閉連線...');
        if (client) {
            await client.close();
        }
        process.exit(0);
    });
}

