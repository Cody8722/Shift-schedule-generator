# 錯誤修復說明文件

## 問題摘要

你遇到的 **HTTP 500 錯誤** 和 **連線關閉錯誤** 主要原因：

### 1. 中文字元 URL 編碼問題 ❌
- **錯誤**: `/api/profiles/%E4%B8%AD%E5%8D%88` (中午)
- **原因**: 後端沒有正確解碼 URL 編碼的中文字元
- **影響**: 所有包含中文的設定檔名稱無法正常更新

### 2. 資料庫連線問題 ❌
- **錯誤**: `net::ERR_CONNECTION_CLOSED`
- **原因**: MongoDB 連線失敗或未設定，導致伺服器崩潰
- **影響**: 整個應用無法使用

### 3. 錯誤處理不足 ⚠️
- 原本的錯誤訊息過於籠統，無法定位問題根源
- 缺少詳細的 debug 日誌

---

## 已修復的問題 ✅

### 修復 1: URL 解碼處理

**修改的路由：**
- `PUT /api/profiles/:name` (line 440)
- `PUT /api/profiles/:name/rename` (line 480)
- `DELETE /api/profiles/:name` (line 503)
- `GET /api/schedules/:name` (line 540)
- `DELETE /api/schedules/:name` (line 555)

**修改內容：**
```javascript
// 修復前
const { name } = req.params;

// 修復後
const name = decodeURIComponent(req.params.name);
```

### 修復 2: 增強錯誤處理

**新增功能：**
1. **設定檔存在性驗證** - 在更新前檢查設定檔是否存在
2. **詳細錯誤訊息** - 返回具體的錯誤原因
3. **Debug 日誌** - 記錄完整的錯誤堆疊
4. **開發模式支援** - 在開發環境下顯示詳細錯誤

**範例：**
```javascript
// 修復後的錯誤回應
res.status(500).json({
    message: '更新設定檔時發生錯誤',
    error: error.message,
    details: process.env.NODE_ENV === 'development' ? error.stack : undefined
});
```

### 修復 3: 更詳細的日誌記錄

**新增的日誌：**
```javascript
debugDb(`設定檔 "${decodedName}" 已成功更新`);
debugDb(`設定檔已重新命名: "${oldName}" → "${newName}"`);
debugDb(`設定檔已刪除: "${nameToDelete}"`);
debugDb(`班表已刪除: "${name}"`);
```

---

## 測試步驟 🧪

### 前置條件
1. **確保 MongoDB 已連線**
   ```bash
   # 檢查 .env 檔案是否存在
   # 如果不存在，請複製 .env.example 並填入你的 MongoDB URI
   ```

2. **啟動伺服器**
   ```bash
   npm start
   # 或使用 debug 模式
   DEBUG=app:* npm start
   ```

### 測試案例 1: 中文設定檔名稱

1. 建立一個中文設定檔（例如：「中午」）
2. 新增勤務和人員
3. 觀察是否出現 500 錯誤
4. 檢查瀏覽器開發者工具的 Network 標籤

**預期結果：**
- ✅ 設定檔成功儲存
- ✅ 沒有 500 錯誤
- ✅ 可以正常切換設定檔

### 測試案例 2: 特殊字元設定檔名稱

測試以下名稱：
- `測試 & 符號`
- `2024-W35班表`
- `早班/晚班`

**預期結果：**
- ✅ 所有特殊字元都能正常處理
- ✅ API 回應正常

### 測試案例 3: 錯誤處理

故意輸入錯誤：
1. 嘗試刪除不存在的設定檔
2. 嘗試重新命名為已存在的名稱

**預期結果：**
- ✅ 顯示明確的錯誤訊息
- ✅ 不會造成伺服器崩潰

---

## 解決資料庫連線問題 🔧

### 問題診斷

如果你看到 `net::ERR_CONNECTION_CLOSED`，可能原因：

1. **未設定 MongoDB URI**
   ```bash
   # 檢查 .env 檔案
   # 確保 MONGODB_URI 不是空的
   ```

2. **MongoDB Atlas 網路限制**
   - 檢查 IP 白名單是否包含你的 IP
   - 或設定為 `0.0.0.0/0`（允許所有 IP，僅用於測試）

3. **資料庫憑證錯誤**
   - 確認帳號密碼正確
   - 特殊字元需要 URL 編碼

### 解決方案

#### 方案 1: 設定正確的 MongoDB URI

1. 複製 `.env.example` 為 `.env`：
   ```bash
   cp .env.example .env
   ```

2. 編輯 `.env` 並填入你的 MongoDB URI：
   ```env
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/
   DB_NAME=scheduleApp
   PORT=3000
   ```

3. 重新啟動伺服器

#### 方案 2: 檢查連線狀態

開啟瀏覽器並訪問：
```
http://localhost:3000/api/status
```

**正常回應：**
```json
{
  "server": "running",
  "database": "connected",
  "holidaysCount": 150,
  "profilesCount": 1,
  "cacheSize": 2
}
```

**異常回應：**
```json
{
  "server": "running",
  "database": "disconnected"
}
```

#### 方案 3: 使用 Debug 模式啟動

```bash
DEBUG=app:* npm start
```

這會顯示詳細的連線日誌：
```
app:server 正在連線至 MongoDB... +0ms
app:db 成功 Ping 到您的部署。您已成功連線至 MongoDB！ +500ms
app:db 正在確認主要設定檔... +10ms
```

---

## 前端錯誤說明

### 錯誤 3: 瀏覽器擴充套件錯誤（可忽略）

```
Uncaught (in promise) Error: A listener indicated an asynchronous response...
```

**原因：** 這是瀏覽器擴充套件的錯誤，與你的應用無關。

**解決方法：**
- 暫時停用所有瀏覽器擴充套件
- 或在無痕模式下測試

---

## 後續建議 💡

### 1. 新增環境變數驗證

在 `server.js` 開頭新增：
```javascript
if (!MONGODB_URI) {
    console.error('❌ 錯誤: 未設定 MONGODB_URI 環境變數！');
    console.error('請檢查 .env 檔案或環境變數設定。');
    process.exit(1); // 終止程式
}
```

### 2. 新增連線重試機制

```javascript
const connectWithRetry = async (retries = 5) => {
    for (let i = 0; i < retries; i++) {
        try {
            await client.connect();
            return true;
        } catch (err) {
            console.log(`連線失敗 (${i + 1}/${retries})，3秒後重試...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    return false;
};
```

### 3. 新增健康檢查端點

已有 `/api/status`，建議定期檢查：
```javascript
setInterval(checkConnectionStatus, 30000); // 每 30 秒檢查一次
```

### 4. 設定檔名稱驗證

在前端新增驗證：
```javascript
function validateProfileName(name) {
    // 禁止使用可能造成問題的字元
    const invalidChars = /[<>:"/\\|?*]/g;
    if (invalidChars.test(name)) {
        alert('設定檔名稱不可包含特殊字元: < > : " / \\ | ? *');
        return false;
    }
    return true;
}
```

---

## 檢查清單 ✅

在測試前，請確認：

- [ ] `.env` 檔案已建立且包含正確的 MongoDB URI
- [ ] 伺服器已重新啟動
- [ ] MongoDB Atlas 的 IP 白名單已設定
- [ ] 瀏覽器開發者工具已開啟（Network & Console）
- [ ] 使用最新的代碼（已套用修復）

---

## 常見問題 FAQ

### Q1: 還是出現 500 錯誤怎麼辦？

**A:** 檢查伺服器終端機的錯誤訊息，現在會顯示詳細的錯誤堆疊。

### Q2: 資料庫一直無法連線？

**A:**
1. 測試 MongoDB URI 是否有效
2. 檢查網路防火牆設定
3. 確認 MongoDB Atlas 服務狀態

### Q3: 如何查看詳細的錯誤訊息？

**A:**
- 後端：使用 `DEBUG=app:* npm start`
- 前端：開啟瀏覽器開發者工具的 Console 標籤

### Q4: 舊的設定檔會受影響嗎？

**A:** 不會。修改只影響 API 路由的處理方式，不會改變資料結構。

---

## 支援

如果問題仍未解決，請提供：
1. 伺服器終端機的完整錯誤訊息
2. 瀏覽器 Console 的錯誤截圖
3. `/api/status` 的回應內容
4. 你的 Node.js 版本 (`node --version`)
5. 你的 MongoDB 連線方式（Atlas / 本地 / Docker）
