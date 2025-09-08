const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'database.json');

// Middleware
app.use(cors()); // 允許跨來源請求
app.use(express.json()); // 解析 JSON request body
app.use(express.static(__dirname)); // 讓伺服器可以提供 index.html 檔案

// API Endpoint to get settings
app.get('/api/settings', async (req, res) => {
    try {
        const data = await fs.readFile(DB_PATH, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        // 如果檔案不存在或有錯誤，回傳一個空的物件
        console.error('無法讀取 database.json:', error);
        res.status(500).json({});
    }
});

// API Endpoint to save settings
app.post('/api/settings', async (req, res) => {
    try {
        const settings = req.body;
        await fs.writeFile(DB_PATH, JSON.stringify(settings, null, 2), 'utf8');
        res.status(200).json({ message: '設定已成功儲存' });
    } catch (error) {
        console.error('無法寫入 database.json:', error);
        res.status(500).json({ message: '儲存設定失敗' });
    }
});

// Fallback to serve index.html for any other route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});

