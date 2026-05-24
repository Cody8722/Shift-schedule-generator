export const checkConnectionStatus = async () => {
  const indicator = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');
  try {
    const response = await fetch('api/status');
    const data = await response.json();
    if (response.ok && data.database === 'connected') {
      if (indicator) indicator.className = 'w-3 h-3 rounded-full bg-green-500 transition-colors';
      if (text) text.textContent = '連線狀態：良好';
    } else {
      if (indicator) indicator.className = 'w-3 h-3 rounded-full bg-yellow-400 transition-colors';
      if (text) text.textContent = '連線狀態：資料庫異常';
    }
  } catch {
    if (indicator) indicator.className = 'w-3 h-3 rounded-full bg-red-500 transition-colors';
    if (text) text.textContent = '連線狀態：伺服器無回應';
  }
};
