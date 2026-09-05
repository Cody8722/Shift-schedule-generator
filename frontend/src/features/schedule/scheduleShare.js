import { api } from '../../api/client.js';
import { getAppState } from '../../state/appState.js';
import { showToast } from '../../ui/toast.js';

let currentScheduleName = null;
let wired = false;

// 事件監聽器只需要綁定一次，openShareModal() 每次開啟只更新內容，不重複掛監聽器。
const ensureWired = () => {
  if (wired) return;
  wired = true;

  document.getElementById('share-generate-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const personFilter = document.getElementById('share-person-select').value || null;
      const expiryRaw = document.getElementById('share-expiry-select').value;
      const expiresInDays = expiryRaw ? parseInt(expiryRaw, 10) : null;
      const result = await api.post('schedule-shares', {
        profile: getAppState().activeProfile,
        scheduleName: currentScheduleName,
        personFilter,
        expiresInDays,
      });
      if (result?.token) {
        const url = `${location.origin}${location.pathname}?share=${result.token}`;
        document.getElementById('share-result-link').value = url;
        document.getElementById('share-result-section').classList.remove('hidden');
      }
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('share-copy-btn').addEventListener('click', async () => {
    const input = document.getElementById('share-result-link');
    try {
      await navigator.clipboard.writeText(input.value);
      showToast('已複製連結', 'success');
    } catch {
      input.select();
      showToast('請手動複製（Ctrl+C）', 'info');
    }
  });

  document.getElementById('share-modal-close-2').addEventListener('click', () => {
    document.getElementById('share-modal').classList.remove('open');
  });
};

// 分享對象清單直接從這份「已儲存班表」的實際內容抓出現過的人名，而不是抓目前設定檔的
// 人員名單——設定檔的人員名單可能在存檔之後又改過，跟這份班表當初實際排到的人會兜不起來。
export async function openShareModal(scheduleName) {
  ensureWired();
  currentScheduleName = scheduleName;

  document.getElementById('share-result-section').classList.add('hidden');
  document.getElementById('share-result-link').value = '';
  document.getElementById('share-expiry-select').value = '';

  const select = document.getElementById('share-person-select');
  select.innerHTML = '<option value="">全部人（完整班表）</option>';

  const scheduleData = await api.get(
    `schedules/${encodeURIComponent(scheduleName)}?profile=${encodeURIComponent(getAppState().activeProfile)}`
  );
  if (scheduleData) {
    const names = new Set();
    scheduleData.forEach((week) => {
      week.schedule.forEach((day) => day.forEach((cell) => cell.forEach((name) => names.add(name))));
    });
    [...names].sort().forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
  }

  document.getElementById('share-modal').classList.add('open');
}
