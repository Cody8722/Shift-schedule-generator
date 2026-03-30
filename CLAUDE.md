# 智慧排班表產生器 Pro - Claude 開發指引

## 專案概述

這是一個企業級智慧排班系統，後端使用 Express.js + MongoDB Atlas，前端為純靜態 HTML + Vanilla JS，部署於 Zeabur（透過 GitHub Actions CI/CD 自動觸發）。

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

**holidays/ 目錄**
- 存放 2025.json、2026.json、2027.json 台灣國定假日資料
- 伺服器啟動時載入，並快取於記憶體（`holidaysCache` Map）

**index.html**
- 單頁應用程式，所有 UI 邏輯內嵌於此
- 透過 Fetch API 呼叫後端，不使用任何前端框架

**tests/server.test.js**
- 使用 supertest 測試 API 端點
- 測試邏輯反映預期行為，**不可修改測試來讓它通過**

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

GitHub Actions（`.github/workflows/ci-cd.yml`）在推送到 `main`/`master` 或開 PR 時觸發，執行：

1. ESLint 靜態分析
2. 單元測試（`npm test`）
3. 驗證 `index.html` 存在
4. Docker 映像建置測試

CI 通過後，Zeabur 會透過 Git 連線自動部署，**無需手動操作**。