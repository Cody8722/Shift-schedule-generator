// 從 /api/status 的假日/學校行事曆自動更新結果中，整理出需要提醒使用者的具體原因。
// 回傳空陣列代表一切正常，不需要顯示警示。
export const buildAutoFetchWarnings = (data) => {
  const reasons = [];
  const years = data?.holidaysLastRefresh?.years || {};
  for (const [year, info] of Object.entries(years)) {
    if (info && info.success === false) {
      reasons.push(`${year} 年假日自動更新失敗${info.error ? `（${info.error}）` : ''}`);
    }
  }
  const school = data?.schoolCalendarLastFetch;
  if (school?.warning) {
    reasons.push(school.warning);
  }
  return reasons;
};

export const checkConnectionStatus = async () => {
  const indicator = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');
  const warningBtn = document.getElementById('autofetch-warning');
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

    if (warningBtn) {
      const reasons = buildAutoFetchWarnings(data);
      if (reasons.length > 0) {
        warningBtn.title = reasons.join('\n');
        warningBtn.dataset.reasons = JSON.stringify(reasons);
        warningBtn.classList.remove('hidden');
      } else {
        warningBtn.classList.add('hidden');
      }
    }
  } catch {
    if (indicator) indicator.className = 'w-3 h-3 rounded-full bg-red-500 transition-colors';
    if (text) text.textContent = '連線狀態：伺服器無回應';
  }
};
