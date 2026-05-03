const { SAFE_PROFILE_NAME_REGEX, SAFE_SCHEDULE_NAME_REGEX } = require('./config');

const escapeHtml = (unsafe) => {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
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

module.exports = {
  escapeHtml,
  validateProfileName,
  validateScheduleName,
  validateSettings,
};
