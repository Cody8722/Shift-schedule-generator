# 智慧排班表產生器 - Claude 開發指引

## 操作規則

- 禁止單獨使用 `cd`，優先使用相對路徑
- 禁止使用 `cd ... && <指令>` 的組合，直接用 `<指令> path/to/target`
- 修改檔案前必須先完整讀過，不靠假設
- 不刪除未觸及的程式碼、注解、TODO
- 不主動重構超出需求範圍的程式碼
- 遇到不確定的需求先問，不自行假設後執行
- 不可覆寫或修改現有的 `.env` 檔案

---

## 架構總覽

```
frontend/（Vite + Vanilla JS ES Modules）
    ↕ HTTP Fetch API（via Vite dev proxy）
backend/（Express.js，拆模組）
    ↕ MongoDB Node.js Driver
MongoDB Atlas（scheduleApp 資料庫）

holidays/（台灣國定假日 JSON，2025–2027）
```

### 啟動方式

```bash
# 後端（port 3000，預設）
cd backend && npm run dev

# 前端（port 5173，proxy → backend）
cd frontend && npm run dev
```

### 目錄結構

```
backend/
  server.js           # 啟動入口
  src/
    app.js            # Express 設定、middleware、路由掛載
    config.js         # 環境變數
    validators.js     # 輸入驗證
    db/connect.js     # MongoDB 連線
    routes/           # status, holidays, profiles, schedules, generate, schoolCalendar
    services/         # scheduleAlgorithm, scheduleRenderer, holidayService
    repositories/     # profileRepository（MongoDB CRUD）
  tests/

frontend/
  index.html
  vite.config.js      # proxy /api → backend
  src/
    main.js           # 主進入點
    api/client.js     # fetch wrapper
    state/            # appState, historyStack, draftManager
    ui/               # toast, modal, theme
    utils/            # escapeHtml, debounce
    features/schedule/ # personnelView, diffSummary

holidays/
  2025.json
  2026.json
  2027.json
```

---

## 向下兼容原則

現有 API 端點不可破壞：

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
GET    /api/school-calendar
```

---

## 環境變數（backend/.env）

```
MONGODB_URI=mongodb+srv://...
DB_NAME=scheduleApp
PORT=3000
CORS_ORIGIN=
```

若未提供 `MONGODB_URI`，伺服器仍會啟動，但所有 DB 操作停用。

---

## 常用指令

```bash
# 後端開發
cd backend && npm run dev

# 後端測試
cd backend && npm test

# 前端開發
cd frontend && npm run dev

# 前端建置
cd frontend && npm run build
```

---

## 分支策略

```
feature/* → develop → release（透過 PR）
```

---

## Commit 規範

格式：`<類型>: <簡短描述>`

| 類型 | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修復 |
| `refactor` | 重構 |
| `docs` | 文件 |
| `test` | 測試 |
| `chore` | 建置工具或雜項 |

---

## 已知地雷

### 🔴 中文字元 URL 編碼

含中文的 Profile 或班表名稱在 URL 路徑會被編碼。所有帶 `:name` 的路由必須用 `decodeURIComponent(req.params.name)`。

### 🔴 無 DB 模式下的靜默失敗

未設定 `MONGODB_URI` 時，DB 操作靜默失敗。診斷：`GET /api/status`。

### 🟡 Tailwind CDN 限制

前端 `index.html` 使用 Tailwind CDN。動態注入的 HTML 不能用 `dark:` inline class，必須改用 `<style>` 中的 `.dark .classname` CSS 選擇器。

### 🟡 holidaysCache 不自動更新

假日資料在伺服器啟動時載入至 memory，修改 JSON 後需重啟才生效。

### 🟡 Vite proxy port

`frontend/vite.config.js` 的 proxy 指向 `http://localhost:3000`，若後端改 port 須同步更新。
