/**
 * 顯示 Toast 通知。
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} duration 毫秒
 */
export const showToast = (message, type = 'info', duration = 3000) => {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
};
