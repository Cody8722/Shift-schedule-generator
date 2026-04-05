# 智慧排班表產生器 Pro - Claude 開發指引

## 專案概述

這是一個企業級智慧排班系統，後端使用 Express.js + MongoDB Atlas，前端為純靜態 HTML + Vanilla JS，部署於 Zeabur（透過 GitHub Actions CI/CD 自動觸發）。

所有程式碼位於 `Shift-schedule-generator/` 子目錄。

---

## 操作規則

以下規則必須在所有對話中嚴格遵守：

- 禁止修改 `.env` 檔案——僅能讀取或更新 `.env.example`；正式環境的連線字串與密鑰由使用者自行管理
- 修改任何檔案前必須先完整讀過，不靠假設
- 不刪除未觸及的程式碼、注解或 TODO
- 不主動重構超出需求範圍的程式碼
- 遇到不確定的需求先問，不自行假設後執行
- 失敗時回報具體錯誤訊息與指令，不要空泛說「發生錯誤」
- 不可為了讓測試通過而修改測試邏輯，應修正程式碼本身
- 每個 bash 呼叫是獨立 session，不依賴上一條指令的環境變數
- 全程以使用者對話的語言回應，包含確認、提問、說明等所有互動，不可中途切換語言
- 禁止單獨使用 `cd`，優先使用絕對或相對路徑直接操作目標檔案
- 禁止使用 `cd ... && <指令>` 組合，改用 `node path/to/server.js` 等直接形式
- 使用者明確要求刪除或移動檔案時，直接執行，無需再反問確認一次

---

## 向下兼容原則

### API 端點

現有 API 端點的參數與回應格式不可破壞。具體規則：

- 不可刪除或重命名現有端點
- 不可移除現有請求參數或回應欄位
- 新增參數必須有預設值（選填）
- 若需破壞性變更，必須先與使用者確認，並考慮版本化（如 `/api/v2/...`）

現有端點清單（不可在無討論下移除）：
```
POST   /api/auth/login   (無需 token；設定 ACCESS_PASSWORD 後需要密碼)
POST   /api/auth/logout
GET    /api/status
GET    /api/holidays/:year
POST   /api/holidays/reseed
PUT    /api/holidays
GET    /api/holidays-in-range
GET    /api/profiles
PUT    /api/profiles/active
POST   /api/profiles
PUT    /api/profiles/:name
PUT    /api/profiles/:name/rename
DELETE /api/profiles/:name
POST   /api/schedules
GET    /api/schedules/:name
DELETE /api/schedules/:name
POST   /api/generate-schedule
POST   /api/render-schedule
GET    /
```

### MongoDB Schema

- 不可刪除或重命名 MongoDB 文件中的現有欄位
- 新增欄位必須有預設值或允許 `null`，以確保與現有資料相容
- 若需移除欄位，必須先與使用者討論 migration 策略

---

## 架構總覽

```
frontend/（index.html + Vanilla JS）
    ↕ HTTP Fetch API（JSON，無身份驗證）
backend/（server.js - Express.js）
    ↕ MongoDB Node.js Driver
MongoDB Atlas（scheduleApp 資料庫）
```

### 主要模組職責

**server.js**（後端主檔）
- Express 伺服器設定（CORS、Rate Limiting、靜態檔案）
- 所有 REST API 端點定義
- MongoDB 連線管理（連線失敗時仍可在無 DB 模式下運行）
- 安全驗證：Profile 名稱正規表達式過濾（防止注入）
  - Profile 名稱：`/^[a-zA-Z0-9_\u4e00-\u9fa5-]{1,50}$/`
  - 班表名稱：`/^[a-zA-Z0-9_\u4e00-\u9fa5-]{1,100}$/`

**holidays/ 目錄**
- 存放 2025.json、2026.json、2027.json 台灣國定假日資料
- 伺服器啟動時載入，並快取於記憶體（`holidaysCache` Map）

**index.html**
- 單頁應用程式，所有 UI 邏輯內嵌於此
- 透過 Fetch API 呼叫後端，不使用任何前端框架

**tests/server.test.js**
- 使用 supertest 測試 API 端點（目前 17 個）
- 測試邏輯反映預期行為，**不可修改測試來讓它通過**

---

## 排班演算法

`server.js` 中的 `generateWeeklySchedule(settings, scheduleDays, cumulativeShifts)` 函數實作核心邏輯。

### 流程

1. **依優先級排序勤務**：`priority` 數值小 = 優先級高（未設定視為 9）
2. **建立 Slot 清單**：高優先勤務的所有 slot 排在低優先之前。同一勤務內每輪隨機打亂天序，避免偏向固定某天
3. **逐 slot 填人**：篩選可用人員（排除 offDays、已達 maxShifts、當天已排過），依三層排序取第一位：
   - ① 跨週累積班次最少（`cumulativeShifts`）
   - ② 本週已排最少（`shiftCounts`）
   - ③ 技能分 × 0.6 + 隨機 × 0.4
4. **回傳診斷資訊**：每個勤務的 `fillStats`（`{ name, priority, filled, needed, ok }`）

### 跨週公平性

`/api/generate-schedule` 在多週迴圈中維護 `cumulativeShifts` Map，每週結束後累加，傳入下一週的排班，確保長期分配均勻。

### 容量限制

若 `sum(personnel.maxShifts) < sum(tasks.count) × 工作天數`，部分 slot 必然空缺。高優先勤務仍會先被填滿，低優先勤務承擔缺口。前端會即時顯示容量預警與填補率表格。

### 輸入驗證

- `numWeeks`：必須是 1–52 的**整數**（小數、0、負數、>52 皆回 400）
- `offDays`：只允許 0–4 的整數（代表週一到週五）

---

## 環境變數

參考 `.env.example`，正式使用時複製為 `.env`：

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
DB_NAME=scheduleApp      # 預設值
PORT=3000                # 預設值
```

若未提供 `MONGODB_URI`，伺服器仍會啟動，但所有資料庫功能會被停用（會顯示警告訊息）。

---

## 常用指令

```bash
# 啟動開發伺服器（需安裝 nodemon）
npm run dev

# 啟動正式伺服器
npm start

# 啟動 debug 模式（詳細日誌）
DEBUG=app:* node server.js

# 執行測試
npm test
```

### 推送前必須確認

1. `npm test` 全部通過
2. `index.html` 存在於根目錄（CI 會驗證）
3. Docker 映像可正常建置（如有修改 Dockerfile）

---

## 分支策略

```
feature/* → develop（測試版） → release（穩定版，透過 PR）
```

- `feature/<name>`：所有新功能與 bug 修復在此開發
- `develop`：整合分支，推送後 GitHub Actions 自動觸發測試；直接 push 到 `develop` 僅限小修（文件、設定）
- `release`：生產前準備分支；**禁止直接 push**，必須從 `develop` 開 PR 合併

---

## Commit 規範

格式：`<類型>: <簡短描述>`

| 類型 | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修復 |
| `refactor` | 重構（非新功能、非 bug）|
| `docs` | 文件變更 |
| `test` | 測試相關 |
| `perf` | 效能優化 |
| `chore` | 建置工具或雜項變更 |
| `ci` | CI/CD 設定變更 |
| `style` | 格式調整（不影響邏輯）|

每約 5 個相關變更，或一個功能階段完成後才 commit。commit 後必須推送到遠端。

---

## CI/CD 說明

GitHub Actions（`.github/workflows/ci-cd.yml`）在推送到 `develop`/`release` 或開 PR 到 `release` 時觸發，執行：

1. ESLint 靜態分析（警告不中斷 CI）
2. 單元測試（`npm test`）
3. 驗證 `index.html` 存在
4. Docker 映像建置測試

CI 通過後，Zeabur 會透過 Git 連線自動部署 `release` 分支，**無需手動操作**。

---

## 特定操作的必做事項

### 新增 API 端點時

1. 同步更新本文件「向下兼容原則」區塊的端點清單
2. 在 `tests/server.test.js` 補上對應的測試案例
3. 確認新端點的 Rate Limiting 是否已套用（`apiLimiter`）

### 修改假日資料（holidays/*.json）時

1. 確認格式與現有 JSON 結構一致
2. 重啟伺服器讓 `holidaysCache` 重新載入（快取在記憶體，不會自動更新）

### 新增 Profile 或 Schedule 相關欄位時

1. 先確認現有 MongoDB 文件格式，再決定預設值
2. 在程式碼中加入向後兼容的 `|| null` 或預設值處理，避免舊資料炸掉

### 修改前端（index.html）時

1. 不可移除或重命名現有的 HTML `id` / `class`（後端不直接依賴，但其他腳本可能有）
2. 若有新增 fetch 呼叫，確認對應的後端端點已存在

---

## 已知地雷 🚧

### 🔴 中文字元 URL 編碼（曾炸過一次）

含中文的 Profile 或班表名稱在 URL 路徑會被編碼（如 `中午` → `%E4%B8%AD%E5%8D%88`）。  
所有帶 `:name` 的路由都**必須**用 `decodeURIComponent(req.params.name)` 處理，否則找不到資料。  
受影響端點：`PUT /api/profiles/:name`、`PUT /api/profiles/:name/rename`、`DELETE /api/profiles/:name`、`GET /api/schedules/:name`、`DELETE /api/schedules/:name`

### 🔴 無 DB 模式下的靜默失敗

未設定 `MONGODB_URI` 時，伺服器仍會正常啟動，但所有資料庫操作會靜默失敗（不崩潰、不報錯給前端）。  
診斷方式：`GET /api/status` 確認 `"database": "connected"` 還是 `"disconnected"`。

### 🟡 Profile 名稱限制（正規表達式過濾）

名稱只允許 `a-zA-Z0-9_中文-`，長度 1–50 字元。  
特殊符號（如 `/`、`&`、空格）會被後端拒絕，但前端目前沒有即時驗證——使用者存檔才會看到錯誤。

### 🟡 holidaysCache 不自動更新

假日資料在伺服器**啟動時**載入進 Map，修改 `holidays/*.json` 後必須重啟伺服器才有效。  
不要在 runtime 直接修改 JSON 後期望立即生效。

### 🟡 tests/server.test.js 的端點路徑

測試直接打 `/api/status`（含前綴），改動路由時要對照確認測試路徑一致。

### 🟢 showcase.html 與 trigger-compact.js

`Shift-schedule-generator/` 根目錄有 `showcase.html`（技術展示頁）和 `trigger-compact.js` 是開發用遺留檔案，不影響主功能，不要刪掉。

---

## 相關文件

| 文件 | 說明 |
|------|------|
| `Shift-schedule-generator/ERROR_FIXES.md` | 歷史 HTTP 500 與連線問題的修復紀錄，查 bug 前先翻這裡 |
| `Shift-schedule-generator/ROADMAP.md` | 功能規劃與技術棧清單 |
| `Shift-schedule-generator/PDF_EXPORT_UPDATE.md` | PDF 匯出功能的實作細節 |
| `Shift-schedule-generator/.env.example` | 環境變數範本，新環境從這裡複製 |
| `Shift-schedule-generator/holidays/` | 台灣國定假日資料（2025–2027），每年需確認更新 |
