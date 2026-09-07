const { SAFE_PROFILE_NAME_REGEX, SAFE_SCHEDULE_NAME_REGEX } = require('./config');

// 一律先用 String() 轉成字串再轉義，不能只在 typeof === 'string' 時才處理——
// 否則陣列／物件會原樣通過這個函式，後面樣板字串插值時呼叫它們自己的
// toString()（例如陣列會 join 內容），繞過所有跳脫直接把原始 HTML 注入。
const escapeHtml = (unsafe) => {
  if (unsafe === null || unsafe === undefined) return unsafe;
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

  for (let i = 0; i < settings.tasks.length; i++) {
    const task = settings.tasks[i];
    if (!task.name || typeof task.name !== 'string' || task.name.length > 100) {
      return { valid: false, error: `Task ${i} 名稱無效` };
    }
    if (typeof task.count !== 'number' || task.count < 1 || task.count > 50) {
      return { valid: false, error: `Task ${i} 人數必須在 1-50 之間` };
    }
    if (
      task.priority !== undefined &&
      (typeof task.priority !== 'number' ||
        !Number.isInteger(task.priority) ||
        task.priority < 1 ||
        task.priority > 9)
    ) {
      return { valid: false, error: `Task ${i} 優先級必須是 1-9 的整數` };
    }
  }

  for (let i = 0; i < settings.personnel.length; i++) {
    const person = settings.personnel[i];
    if (!person.name || typeof person.name !== 'string' || person.name.length > 50) {
      return { valid: false, error: `Personnel ${i} 名稱無效` };
    }
    if (
      person.maxShifts !== undefined &&
      (typeof person.maxShifts !== 'number' || person.maxShifts < 1 || person.maxShifts > 7)
    ) {
      return { valid: false, error: `Personnel ${i} maxShifts 必須在 1-7 之間` };
    }
    if (person.offDays !== undefined && !Array.isArray(person.offDays)) {
      return { valid: false, error: `Personnel ${i} offDays 必須是數組` };
    }
    if (person.offDays && !person.offDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 4)) {
      return { valid: false, error: `人員 ${i + 1} 的 offDays 只能包含 0-4 的整數（代表週一到週五）` };
    }
    if (person.taskScores !== undefined) {
      if (
        typeof person.taskScores !== 'object' ||
        person.taskScores === null ||
        Array.isArray(person.taskScores)
      ) {
        return { valid: false, error: `Personnel ${i} taskScores 必須是物件` };
      }
      for (const [taskName, score] of Object.entries(person.taskScores)) {
        if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 5) {
          return {
            valid: false,
            error: `Personnel ${i} 的 taskScores["${taskName}"] 必須是 0-5 的整數`,
          };
        }
      }
    }
  }

  return { valid: true };
};

const validateScheduleData = (data) => {
  if (!Array.isArray(data) || data.length === 0) {
    return { valid: false, error: '班表數據必須是非空數組' };
  }

  for (let w = 0; w < data.length; w++) {
    const week = data[w];
    if (!week || typeof week !== 'object') {
      return { valid: false, error: `第 ${w} 週資料格式錯誤` };
    }
    if (typeof week.dateRange !== 'string') {
      return { valid: false, error: `第 ${w} 週 dateRange 必須是字串` };
    }
    if (!Array.isArray(week.weekDayDates)) {
      return { valid: false, error: `第 ${w} 週 weekDayDates 必須是數組` };
    }
    if (!Array.isArray(week.scheduleDays)) {
      return { valid: false, error: `第 ${w} 週 scheduleDays 必須是數組` };
    }
    if (!Array.isArray(week.schedule)) {
      return { valid: false, error: `第 ${w} 週 schedule 必須是數組` };
    }
    if (!Array.isArray(week.tasks)) {
      return { valid: false, error: `第 ${w} 週 tasks 必須是數組` };
    }
    for (let i = 0; i < week.tasks.length; i++) {
      const task = week.tasks[i];
      if (!task || typeof task.name !== 'string' || task.name.length > 100) {
        return { valid: false, error: `第 ${w} 週 Task ${i} 名稱無效` };
      }
      if (typeof task.count !== 'number' || !Number.isFinite(task.count)) {
        return { valid: false, error: `第 ${w} 週 Task ${i} 人數必須是數字` };
      }
      if (
        task.priority !== undefined &&
        (typeof task.priority !== 'number' ||
          !Number.isInteger(task.priority) ||
          task.priority < 1 ||
          task.priority > 9)
      ) {
        return { valid: false, error: `第 ${w} 週 Task ${i} 優先級必須是 1-9 的整數` };
      }
    }
  }

  return { valid: true };
};

module.exports = {
  escapeHtml,
  validateProfileName,
  validateScheduleName,
  validateSettings,
  validateScheduleData,
};
