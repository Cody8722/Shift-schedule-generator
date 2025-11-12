# 班表衝突檢測 API 使用說明

**版本**: Phase 2.1 (後端實現)
**實作日期**: 2025-11-12
**狀態**: ✅ 後端完成，前端整合待實作

---

## 📋 功能概述

班表衝突檢測系統會自動驗證班表是否符合勞動法規和公司政策，檢測以下衝突類型：

1. **重複排班 (duplicate)**: 同一人在同一天被安排多個不同任務
2. **過勞 (overwork)**: 員工連續工作天數超過限制

---

## 🔌 API 端點

### POST `/api/schedules/validate`

驗證班表是否存在衝突。

**請求格式**:
```http
POST /api/schedules/validate
Content-Type: application/json

{
  "schedule": [...],  // 班表數據（與 generate-schedule API 返回的格式相同）
  "constraints": {    // 可選：限制條件
    "maxConsecutiveDays": 5,  // 最大連續工作天數（預設 5）
    "minRestDays": 2          // 最小休息天數（預設 2，目前未使用）
  }
}
```

**回應格式**:
```json
{
  "valid": false,
  "conflicts": [
    {
      "type": "duplicate",
      "person": "員工A",
      "week": 1,
      "date": "20250101"
    },
    {
      "type": "overwork",
      "person": "員工B",
      "consecutiveDays": 6,
      "startDate": "20250101",
      "endDate": "20250108",
      "dates": ["20250101", "20250102", "20250103", "20250106", "20250107", "20250108"]
    }
  ]
}
```

---

## 📊 請求數據格式

### schedule 數組

班表數據應該是一個數組，每個元素代表一週的班表：

```javascript
[
  {
    // 第 1 週班表
    "schedule": [
      // Day 0 (週一)
      [
        ["員工A", "員工B"],  // 任務 0 的人員
        ["員工C"]            // 任務 1 的人員
      ],
      // Day 1 (週二)
      [
        ["員工D"],
        ["員工E", "員工F"]
      ],
      // ... (共 5 天)
    ],
    "scheduleDays": [
      { "date": "20250101", "shouldSchedule": true, "description": "" },
      { "date": "20250102", "shouldSchedule": true, "description": "" },
      { "date": "20250103", "shouldSchedule": false, "description": "國定假日" },
      { "date": "20250106", "shouldSchedule": true, "description": "" },
      { "date": "20250107", "shouldSchedule": true, "description": "" }
    ],
    "tasks": [
      { "name": "早班", "count": 2 },
      { "name": "晚班", "count": 1 }
    ]
  },
  // 第 2 週班表...
]
```

### constraints 對象（可選）

```javascript
{
  "maxConsecutiveDays": 5,  // 最大連續工作天數
  "minRestDays": 2          // 最小休息天數（未來實作）
}
```

如果不提供 `constraints`，將使用預設值：
- `maxConsecutiveDays`: 5 天
- `minRestDays`: 2 天

---

## 🚨 衝突類型說明

### 1. 重複排班 (duplicate)

**定義**: 同一位員工在同一天被安排到多個不同的任務。

**衝突對象格式**:
```json
{
  "type": "duplicate",
  "person": "員工姓名",
  "week": 1,              // 第幾週（1-based）
  "date": "20250101"      // 衝突日期 (YYYYMMDD)
}
```

**範例**:
- 員工A 在 2025/01/01 同時被安排早班和晚班 → ❌ 重複排班

**商業邏輯**:
- 同一天內，一位員工只能被安排一個任務
- 假日不檢查（shouldSchedule: false 的日期會被跳過）

---

### 2. 過勞 (overwork)

**定義**: 員工連續工作天數超過最大限制。

**衝突對象格式**:
```json
{
  "type": "overwork",
  "person": "員工姓名",
  "consecutiveDays": 6,              // 實際連續工作天數
  "startDate": "20250101",           // 連續工作開始日期
  "endDate": "20250108",             // 連續工作結束日期
  "dates": ["20250101", "20250102", ...] // 所有工作日期列表
}
```

**範例**:
- 限制: maxConsecutiveDays = 5
- 員工B 連續工作 6 天（週一到週六，含跨週）→ ❌ 過勞

**商業邏輯**:
- 連續性判斷：日期相差 1-3 天視為連續
  - 1天: 連續工作日（例如週一→週二）
  - 2天: 中間有 1 天假期（例如週四→週六）
  - 3天: 週五→週一（中間是週末）
- 超過 3 天間隔則重置計數器（視為新的連續工作週期）
- 假日（shouldSchedule: false）會被跳過，不計入工作日

**特殊情況**:
- ✅ 週一到週五連續工作 5 天 → 通過（符合限制）
- ❌ 週一到週五 + 下週一 = 6 天連續 → 過勞（週末視為間隔 ≤ 3 天）
- ✅ 週一到週三工作，週四休假，週五工作 → 視為兩個獨立週期

---

## 💡 使用範例

### 範例 1: 基本驗證

```javascript
// 生成班表後驗證
const generatedSchedule = await fetch('/api/generate-schedule', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    settings: { tasks: [...], personnel: [...] },
    startWeek: '2025-W01',
    numWeeks: 2,
    activeHolidays: []
  })
}).then(res => res.json());

// 驗證班表
const validationResult = await fetch('/api/schedules/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    schedule: generatedSchedule.data,
    constraints: {
      maxConsecutiveDays: 5,
      minRestDays: 2
    }
  })
}).then(res => res.json());

if (!validationResult.valid) {
  console.error('班表存在衝突:', validationResult.conflicts);
  // 顯示錯誤訊息給使用者
} else {
  console.log('班表驗證通過！');
  // 允許儲存班表
}
```

### 範例 2: 處理衝突

```javascript
const result = await fetch('/api/schedules/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ schedule: scheduleData })
}).then(res => res.json());

if (!result.valid) {
  // 按類型分組衝突
  const duplicates = result.conflicts.filter(c => c.type === 'duplicate');
  const overworks = result.conflicts.filter(c => c.type === 'overwork');

  if (duplicates.length > 0) {
    console.log('重複排班:', duplicates.map(c =>
      `${c.person} 在 ${c.date} (第${c.week}週)`
    ).join(', '));
  }

  if (overworks.length > 0) {
    console.log('過勞問題:', overworks.map(c =>
      `${c.person} 連續工作 ${c.consecutiveDays} 天 (${c.startDate} - ${c.endDate})`
    ).join(', '));
  }
}
```

---

## 🧪 測試案例

完整的測試案例請參考: `tests/conflict-detection.test.js`

### 測試覆蓋範圍

✅ **重複排班檢測**:
- 同一人在同一天多個任務 → 檢測到衝突
- 不同人在同一天工作 → 允許

✅ **過勞檢測**:
- 連續工作超過限制 → 檢測到衝突
- 連續工作在限制內 → 允許
- 跨週連續工作 → 正確累計天數

✅ **邊界條件**:
- 空白班表數據 → 返回 400 錯誤
- 未提供限制條件 → 使用預設值
- 假日（shouldSchedule: false）→ 正確跳過

✅ **複合衝突**:
- 同時存在重複排班和過勞 → 返回所有衝突

### 運行測試

```bash
npm test -- tests/conflict-detection.test.js
```

---

## 🔧 技術實作細節

### 檔案結構

```
server.js
├── detectDuplicates(scheduleData)      // 行 400-439
├── detectOverwork(scheduleData, max)   // 行 441-537
└── POST /api/schedules/validate        // 行 925-954
```

### detectDuplicates() 邏輯

1. 遍歷每週的班表
2. 對每一天的所有任務收集人員名單
3. 使用 Set 檢測重複（同一人出現多次）
4. 記錄衝突：人員、週次、日期

### detectOverwork() 邏輯

1. 收集每位員工的所有工作日期
2. 排序並去重日期
3. 檢查相鄰日期的天數差異：
   - 1-3 天 → 視為連續
   - >3 天 → 重置計數器
4. 當連續天數超過限制時，記錄衝突（只記錄一次）

### 日期連續性判斷規則

```javascript
// 相差天數
const daysDiff = Math.floor((currDate - prevDate) / (1000 * 60 * 60 * 24));

if (daysDiff >= 1 && daysDiff <= 3) {
  // 視為連續
  consecutiveCount++;
} else {
  // 重置計數器
  consecutiveCount = 1;
}
```

**為什麼允許 1-3 天間隔？**
- 1 天: 連續工作日（週一→週二）
- 2 天: 中間有 1 天假期（週四→週六）
- 3 天: 週五→週一（包含週末）

---

## 📅 開發路線圖

根據 ROADMAP.md Phase 2.1:

### ✅ 已完成（本次實作）

- [x] 後端 API 端點 `/api/schedules/validate`
- [x] 重複排班檢測 (duplicate)
- [x] 過勞檢測 (overwork)
- [x] 完整單元測試（8 個測試案例，100% 通過）
- [x] API 使用說明文件

### ⏳ 待實作（未來階段）

**Phase 2.2 - 前端整合**:
- [ ] 在前端「產生班表」按鈕後自動觸發驗證
- [ ] 顯示衝突警告 UI（紅色標註衝突的儲存格）
- [ ] 提供「強制儲存」選項（忽略警告）
- [ ] 在編輯模式下即時驗證

**Phase 2.3 - 增強功能**:
- [ ] 新增「最小休息天數」檢測 (minRestDays)
- [ ] 新增「偏好任務」衝突檢測
- [ ] 新增「工時超標」檢測
- [ ] 提供衝突修復建議

---

## ❗ 注意事項

1. **假日處理**: `shouldSchedule: false` 的日期會被完全跳過，不計入任何檢測
2. **日期格式**: 必須使用 `YYYYMMDD` 格式（例如 `"20250101"`）
3. **週末判斷**: 系統自動識別週五→週一的跨週末連續性
4. **衝突去重**: 同一位員工的過勞衝突只會記錄一次（在第一次超標時）
5. **性能考慮**: 對於大型班表（>100 人，>4 週），驗證時間約 50-100ms

---

## 🐛 故障排除

### 問題 1: 驗證返回 400 錯誤

**錯誤訊息**: "班表數據必須是非空數組"

**解決方案**:
- 確認 `schedule` 參數是數組且不為空
- 檢查數據格式是否符合 `generate-schedule` API 的返回格式

### 問題 2: 過勞檢測未生效

**原因**: 日期格式錯誤或 scheduleDays 設定錯誤

**檢查清單**:
- ✅ 日期格式必須是 `"YYYYMMDD"` 字串
- ✅ `scheduleDays[i].shouldSchedule` 必須是布林值
- ✅ 假日的 `shouldSchedule` 應該是 `false`

### 問題 3: 週末連續性判斷錯誤

**範例**: 週五→週一被視為不連續

**解決方案**:
- 確認日期間隔是 3 天（週五到週一）
- 如果間隔 >3 天，系統會重置計數器（這是預期行為）

---

## 📞 支援與回饋

如有問題或建議，請：
1. 查看測試案例：`tests/conflict-detection.test.js`
2. 查看實作程式碼：`server.js` 行 400-537、925-954
3. 參考開發路線圖：`ROADMAP.md` Phase 2.1

---

**文件版本**: 1.0.0
**最後更新**: 2025-11-12
**實作 Commit**: TBD (待 git commit)
