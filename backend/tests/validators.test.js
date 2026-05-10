'use strict';

const {
  escapeHtml,
  validateProfileName,
  validateScheduleName,
  validateSettings,
} = require('../src/validators');

// ─── escapeHtml ────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('轉義 &', () => expect(escapeHtml('a&b')).toBe('a&amp;b'));
  it('轉義 <', () => expect(escapeHtml('<script>')).toBe('&lt;script&gt;'));
  it('轉義 >', () => expect(escapeHtml('x>y')).toBe('x&gt;y'));
  it('轉義 "', () => expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;'));
  it("轉義 '", () => expect(escapeHtml("it's")).toBe('it&#039;s'));
  it('安全字串不變', () => expect(escapeHtml('hello world 123')).toBe('hello world 123'));
  it('非字串型別原樣回傳', () => {
    expect(escapeHtml(42)).toBe(42);
    expect(escapeHtml(null)).toBe(null);
    expect(escapeHtml(undefined)).toBe(undefined);
  });
});

// ─── validateProfileName ──────────────────────────────────────────────────

describe('validateProfileName', () => {
  it('英數字元合法', () => expect(validateProfileName('abc123').valid).toBe(true));
  it('中文名稱合法', () => expect(validateProfileName('早班組').valid).toBe(true));
  it('含底線與連字號合法', () => expect(validateProfileName('group_A-1').valid).toBe(true));
  it('空字串回傳 invalid', () => expect(validateProfileName('').valid).toBe(false));
  it('null 回傳 invalid', () => expect(validateProfileName(null).valid).toBe(false));
  it('非字串型別回傳 invalid', () => expect(validateProfileName(123).valid).toBe(false));
  it('含空格回傳 invalid', () => expect(validateProfileName('hello world').valid).toBe(false));
  it('含特殊符號 / 回傳 invalid', () => expect(validateProfileName('a/b').valid).toBe(false));
  it('51 字元超出上限', () => expect(validateProfileName('a'.repeat(51)).valid).toBe(false));
  it('50 字元正好合法', () => expect(validateProfileName('a'.repeat(50)).valid).toBe(true));
});

// ─── validateScheduleName ─────────────────────────────────────────────────

describe('validateScheduleName', () => {
  it('合法名稱通過', () => expect(validateScheduleName('2025-W01').valid).toBe(true));
  it('100 字元正好合法', () => expect(validateScheduleName('a'.repeat(100)).valid).toBe(true));
  it('101 字元超出上限', () => expect(validateScheduleName('a'.repeat(101)).valid).toBe(false));
  it('空字串回傳 invalid', () => expect(validateScheduleName('').valid).toBe(false));
  it('null 回傳 invalid', () => expect(validateScheduleName(null).valid).toBe(false));
});

// ─── validateSettings ─────────────────────────────────────────────────────

const minSettings = () => ({
  tasks: [{ name: '早班', count: 1 }],
  personnel: [{ name: '張三' }],
});

describe('validateSettings', () => {
  it('最小合法 settings 通過', () => expect(validateSettings(minSettings()).valid).toBe(true));

  it('tasks 非陣列回傳 invalid', () => {
    const s = { ...minSettings(), tasks: 'string' };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('personnel 非陣列回傳 invalid', () => {
    const s = { ...minSettings(), personnel: null };
    expect(validateSettings(s).valid).toBe(false);
  });

  // task 欄位驗證
  it('task.count=0 低於下限', () => {
    const s = { tasks: [{ name: '早班', count: 0 }], personnel: [{ name: '張三' }] };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('task.count=51 超出上限', () => {
    const s = { tasks: [{ name: '早班', count: 51 }], personnel: [{ name: '張三' }] };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('task.count=1 合法', () => {
    const s = { tasks: [{ name: '早班', count: 1 }], personnel: [{ name: '張三' }] };
    expect(validateSettings(s).valid).toBe(true);
  });

  it('task.count=50 合法', () => {
    const s = { tasks: [{ name: '早班', count: 50 }], personnel: [{ name: '張三' }] };
    expect(validateSettings(s).valid).toBe(true);
  });

  it('task.priority=0 低於下限', () => {
    const s = { tasks: [{ name: '早班', count: 1, priority: 0 }], personnel: [{ name: '張三' }] };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('task.priority=10 超出上限', () => {
    const s = { tasks: [{ name: '早班', count: 1, priority: 10 }], personnel: [{ name: '張三' }] };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('task.priority=1.5 非整數', () => {
    const s = { tasks: [{ name: '早班', count: 1, priority: 1.5 }], personnel: [{ name: '張三' }] };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('task.priority 未設定時合法（選填）', () => {
    const s = { tasks: [{ name: '早班', count: 1 }], personnel: [{ name: '張三' }] };
    expect(validateSettings(s).valid).toBe(true);
  });

  it('task 名稱空字串回傳 invalid', () => {
    const s = { tasks: [{ name: '', count: 1 }], personnel: [{ name: '張三' }] };
    expect(validateSettings(s).valid).toBe(false);
  });

  // personnel 欄位驗證
  it('person.maxShifts=0 低於下限', () => {
    const s = { tasks: [{ name: '早班', count: 1 }], personnel: [{ name: '張三', maxShifts: 0 }] };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('person.maxShifts=8 超出上限', () => {
    const s = { tasks: [{ name: '早班', count: 1 }], personnel: [{ name: '張三', maxShifts: 8 }] };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('person.maxShifts=7 合法', () => {
    const s = { tasks: [{ name: '早班', count: 1 }], personnel: [{ name: '張三', maxShifts: 7 }] };
    expect(validateSettings(s).valid).toBe(true);
  });

  it('person.offDays=[0,4] 合法', () => {
    const s = { tasks: [{ name: '早班', count: 1 }], personnel: [{ name: '張三', offDays: [0, 4] }] };
    expect(validateSettings(s).valid).toBe(true);
  });

  it('person.offDays=[5] 超出上限', () => {
    const s = { tasks: [{ name: '早班', count: 1 }], personnel: [{ name: '張三', offDays: [5] }] };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('person.offDays=[-1] 負數', () => {
    const s = { tasks: [{ name: '早班', count: 1 }], personnel: [{ name: '張三', offDays: [-1] }] };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('person.offDays 非陣列回傳 invalid', () => {
    const s = { tasks: [{ name: '早班', count: 1 }], personnel: [{ name: '張三', offDays: 1 }] };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('person.taskScores 合法（整數 0-5）', () => {
    const s = {
      tasks: [{ name: '早班', count: 1 }],
      personnel: [{ name: '張三', taskScores: { 早班: 5, 午班: 0 } }],
    };
    expect(validateSettings(s).valid).toBe(true);
  });

  it('person.taskScores 含非整數值', () => {
    const s = {
      tasks: [{ name: '早班', count: 1 }],
      personnel: [{ name: '張三', taskScores: { 早班: 2.5 } }],
    };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('person.taskScores 含值 > 5', () => {
    const s = {
      tasks: [{ name: '早班', count: 1 }],
      personnel: [{ name: '張三', taskScores: { 早班: 6 } }],
    };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('person.taskScores 為陣列（非物件）回傳 invalid', () => {
    const s = {
      tasks: [{ name: '早班', count: 1 }],
      personnel: [{ name: '張三', taskScores: [5] }],
    };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('settings 為 null 回傳 invalid', () => {
    expect(validateSettings(null).valid).toBe(false);
  });

  it('settings 為字串回傳 invalid', () => {
    expect(validateSettings('{}').valid).toBe(false);
  });
});
