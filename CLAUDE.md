# 智慧排班表產生器 - Claude 開發指引

## 專案概述

企業級智慧排班系統，後端 Express.js + MongoDB Atlas，前端 Vite + Vanilla JS ES Modules。

---

@~/.claude/rules/common/claude-md-guide.md
@~/.claude/rules/common/development-workflow.md
@~/.claude/rules/common/git-workflow.md
@~/.claude/rules/common/coding-style.md
@~/.claude/rules/typescript/coding-style.md

> 通用操作規則（Bash、git、commit、分支主幹、程式碼風格、memory 維護）見 `~/.claude/CLAUDE.md`。本檔只列本專案專屬內容。

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
GET    /api/school-events
POST   /api/school-events/refresh
GET    /
GET    /robots.txt
```

### MongoDB Schema

- 不可刪除或重命名 MongoDB 文件中的現有欄位
- 新增欄位必須有預設值或允許 `null`，以確保與現有資料相容
- 若需移除欄位，必須先與使用者討論 migration 策略

MongoDB 集合清單（`scheduleApp` 資料庫）：
- `profiles`：設定檔與排班資料
- `holidays`：台灣國定假日（`_id` 為日期字串如 `2025-01-01`）
- `schoolEvents`：學校行事曆快取（`_id` 為學期代碼如 `1142`，7 天 TTL）

---

## 架構總覽

```
frontend/（Vite + Vanilla JS ES Modules，port 5173）
    ↕ HTTP Fetch API（Vite dev proxy → backend）
backend/（Express.js 拆模組，port 3000）
    ↕ MongoDB Node.js Driver
MongoDB Atlas（scheduleApp 資料庫）

holidays/（台灣國定假日 JSON，2025–2027）
```

### 目錄結構

```
backend/
  server.js                      # 啟動入口
  src/
    app.js                       # Express 設定、middleware、路由掛載
    config.js                    # 環境變數
    validators.js                # 輸入驗證（profile/schedule 名稱、settings）
    db/connect.js                # MongoDB 連線管理（profiles、holidays、schoolEvents 三個 collection）
    routes/                      # status, holidays, profiles, schedules, generate, schoolCalendar
    services/
      scheduleAlgorithm.js       # 排班核心演算法（純函數）
      scheduleRenderer.js        # HTML 渲染
      holidayService.js          # 假日快取、CDN 更新
      schoolCalendar.js          # 學校行事曆（記憶體 6h + MongoDB 7 天持久快取）
    repositories/
      profileRepository.js       # MongoDB CRUD（profiles、schedules）
  tests/

frontend/
  index.html                     # HTML 入口，載入 CDN（Tailwind、ExcelJS、jsPDF、html2canvas）
  vite.config.js                 # proxy /api → http://localhost:3000
  src/
    main.js                      # 主進入點（約 750 行，DOM 事件綁定 + 初始化）
    api/client.js                # fetch wrapper（get/post/put/delete）
    state/
      appState.js                # 全域狀態（activeProfile、generatedData、editingData）
      historyStack.js            # undo/redo 堆疊
      draftManager.js            # localStorage 草稿自動存/恢復
    ui/
      toast.js                   # Toast 通知
      modal.js                   # 確認 Modal
      theme.js                   # 深色/淺色模式切換
      tutorial.js                # 新手導覽
    utils/
      escapeHtml.js
      debounce.js
      capacityStatus.js          # 容量/填補率狀態計算
      connectionStatus.js        # 後端連線狀態顯示
      excelDownload.js           # ExcelJS Workbook → Blob 觸發瀏覽器下載
      exportFilename.js          # 組合匯出檔名（班表名稱_日期範圍_時間戳記），PDF/Excel/人員Excel 共用
    features/schedule/
      personnelView.js           # 人員月曆視圖 + Excel 下載
      diffSummary.js             # 變更摘要 Modal（buildDiff、共用 renderDiffSection）
      editableSchedule.js        # 可編輯班表（含單格重排、拖曳對調）
      scheduleCompare.js         # 比較已儲存班表 Modal（人員異動/填補率/勤務設定差異）
      exportWeekFilter.js        # 匯出週次篩選（getExportData，供複製/Excel/PDF/人員Excel 共用）
      personTaskStats.js         # 值勤統計 Modal（人員 × 勤務次數，加總 + 每週明細，Excel/PDF 匯出共用同一份計算）
      pdfExport.js               # PDF 匯出（html2canvas + jsPDF，支援每頁 N 週自動分頁，末頁附值勤統計）
      scheduleGenerator.js       # 前端排班產生流程
    features/settings/
      settingsRenderer.js        # 設定頁渲染

（部分 *.test.js 為 Vitest 單元測試，與被測檔案同目錄）

e2e/                              # Playwright E2E 測試（CI 會另外裝瀏覽器執行）
  playwright.config.js
  global-setup.js / global-teardown.js
  tests/                          # 01-page-load ~ 05-advanced-editing

holidays/
  2025.json / 2026.json / 2027.json
```

### 安全驗證（validators.js）

- Profile 名稱：`/^[a-zA-Z0-9_一-龥-]{1,50}$/`
- 班表名稱：`/^[a-zA-Z0-9_一-龥-]{1,100}$/`

---

## 排班演算法

`backend/src/services/scheduleAlgorithm.js` 的 `generateWeeklySchedule(settings, scheduleDays, cumulativeShifts)` 實作核心邏輯。

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

## 環境變數（backend/.env）

參考 `backend/.env.example`：

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
DB_NAME=scheduleApp      # 預設值
PORT=3000                # 預設值
CORS_ORIGIN=*            # 預設值；未設定時 config.js 也會 fallback 成 *，僅適合開發環境
```

若未提供 `MONGODB_URI`，伺服器仍會啟動，但所有資料庫功能停用（會顯示警告）。

---

## 常用指令

```bash
# 後端開發伺服器
npm --prefix backend run dev

# 後端 debug 模式（環境變數寫在指令最前面，仍是單一指令）
DEBUG=app:* node backend/server.js

# 後端測試（Jest）
npm --prefix backend test

# 前端開發伺服器（port 5173，proxy → backend:3000）
npm --prefix frontend run dev

# 前端建置
npm --prefix frontend run build

# 前端測試（Vitest）
npm --prefix frontend test

# E2E 測試（Playwright，需先跑起 backend + frontend dev server）
npm run test:e2e          # 根目錄 package.json 的捷徑，實際是 cd e2e && npx playwright test
npm run test:e2e:ui       # Playwright UI 模式
```

### 推送前必須確認

```bash
npm --prefix backend test    # 後端全部通過
npm --prefix frontend test   # 前端全部通過
```

---

## 分支策略（本專案額外）

分支主幹見全域，本專案額外：
- `develop`：推送後 CI 自動觸發測試；直接 push 僅限小修（文件、設定）
- `release`：**禁止直接 push**，必須從 `develop` 開 PR 合併

---

## CI/CD 說明

GitHub Actions（`.github/workflows/ci-cd.yml`）在推送到 `develop`/`release` 或開 PR 到 `release` 時觸發，平行執行三個 job：

1. `backend-test`：`backend/` 安裝依賴 + `npm test`（Jest）
2. `frontend-test`：`frontend/` 安裝依賴 + `npm test`（Vitest）
3. `e2e-test`：安裝 `backend/`、`frontend/`、`e2e/` 依賴，`npx playwright install --with-deps chromium`，再跑 `npx playwright test`；失敗時上傳 `playwright-report` artifact（保留 7 天）

---

## 特定操作的必做事項

### 新增 API 端點時

1. 同步更新本文件「向下兼容原則」區塊的端點清單
2. 在 `backend/tests/` 補上對應的測試案例
3. 確認新端點的 Rate Limiting 已套用（`readLimiter` 或 `writeLimiter`）

### 修改假日資料（holidays/*.json）時

1. 確認格式與現有 JSON 結構一致
2. 這些本地 JSON 只有在 `holidays` collection 是空的時候，才會被 `seedHolidays()` 讀取植入——**單純重啟後端不會套用變更**
3. 要讓變更反映到資料庫：呼叫 `POST /api/holidays/reseed`（清空 collection，改從 CDN 重抓，不會讀本地 JSON），或用 `PUT /api/holidays` 逐筆改

### 新增 Profile 或 Schedule 相關欄位時

1. 先確認現有 MongoDB 文件格式，再決定預設值
2. 在程式碼中加入向後兼容的 `|| null` 或預設值處理，避免舊資料炸掉

### 修改前端（frontend/src/）時

1. 動態注入的 HTML **不可使用** Tailwind `dark:` inline class（CDN 不編譯動態 class）
   → 改用 `<style>` 中的 `.dark .classname` CSS 選擇器
2. 若有新增 fetch 呼叫，確認對應的後端端點已存在

---

## 程式碼風格

- **縮排**：2 空格
- **引號**：單引號

---

## 已知地雷 🚧

### 🔴 中文字元 URL 編碼（曾炸過一次）

含中文的 Profile 或班表名稱在 URL 路徑會被編碼（如 `中午` → `%E4%B8%AD%E5%8D%88`）。
所有帶 `:name` 的路由都**必須**用 `decodeURIComponent(req.params.name)` 處理，否則找不到資料。
受影響端點：`PUT /api/profiles/:name`、`PUT /api/profiles/:name/rename`、`DELETE /api/profiles/:name`、`GET /api/schedules/:name`、`DELETE /api/schedules/:name`

### 🔴 無 DB 模式下的行為不一致（不是「全部」靜默失敗）

未設定 `MONGODB_URI` 時，伺服器仍會正常啟動。`profiles`/`schedules`/`holidays` 相關路由都有 `getIsDbConnected()` 檢查，會明確回傳 503「資料庫未連線」給前端。
但 `POST /api/generate-schedule`、`POST /api/render-schedule` **沒有**這層檢查：內部呼叫的 `getHolidaysForYear()` 在無 DB 時直接回傳空 `Map`，假日/行事曆資料會被靜默忽略、班表照樣「成功」產生，前端不會收到任何錯誤或警告。
診斷方式：`GET /api/status` 確認 `"database": "connected"` 還是 `"disconnected"`。

### 🟡 Tailwind CDN 動態 HTML 限制

前端使用 Tailwind CDN（JIT 模式），**動態注入的 innerHTML 中的 `dark:` class 不會被編譯**。
所有深色模式樣式必須在 `<style>` 區塊以 `.dark .classname` 形式定義。

### 🟡 Profile 名稱限制（正規表達式過濾）

名稱只允許 `a-zA-Z0-9_中文-`，長度 1–50 字元。
特殊符號（如 `/`、`&`、空格）會被後端拒絕，但前端目前沒有即時驗證——使用者存檔才會看到錯誤。

### 🟡 holidaysCache 的自動/手動更新範圍不同

`server.js` 啟動時、以及之後**每 24 小時**都會自動呼叫 `refreshHolidaysFromCDN()`，重新從 CDN 拉「今年 + 明年」的假日資料並清掉對應快取——這兩年的資料其實會自動更新。
不會自動更新的是：**去年（含）以前**的資料、以及最初從 `holidays/*.json` 植入（無 `source:'cdn'` 標記）的資料。要強制整批重抓三年資料，呼叫 `POST /api/holidays/reseed`（清空整個 collection + 記憶體快取，全部重新從 CDN 拉）。
直接修改 `holidays/*.json` 不會生效——只有 collection 是空的時候（`seedHolidays()`）才會讀本地檔案；reseed 走的是 CDN，不讀本地 JSON。

### 🟡 backend/tests/ 的端點路徑

測試直接打 `/api/status`（含前綴），改動路由時要對照確認測試路徑一致。

### 🟡 Vite proxy port

`frontend/vite.config.js` 的 proxy 指向 `http://localhost:3000`，若後端改 PORT 須同步更新。

---

## 相關文件

| 文件 | 說明 |
|------|------|
| `backend/.env.example` | 環境變數範本，新環境從這裡複製 |
| `holidays/` | 台灣國定假日資料（2025–2027），每年需確認更新 |
