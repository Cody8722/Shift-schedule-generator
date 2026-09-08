/**
 * HTML 轉義，防止 XSS 注入。
 * 一律先用 String() 轉成字串再轉義，不能只在 typeof === 'string' 時才處理——
 * 否則陣列／物件會原樣通過這個函式，後面樣板字串插值時呼叫它們自己的
 * toString()（例如陣列會 join 內容），繞過所有跳脫直接把原始 HTML 注入。
 * @param {*} unsafe
 * @returns {*}
 */
export const escapeHtml = (unsafe) => {
  if (unsafe === null || unsafe === undefined) return unsafe;
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};
