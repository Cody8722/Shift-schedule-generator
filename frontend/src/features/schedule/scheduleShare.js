import { api } from '../../api/client.js';
import { getAppState } from '../../state/appState.js';
import { showToast } from '../../ui/toast.js';
import { escapeHtml } from '../../utils/escapeHtml.js';

let currentScheduleName = null;
let wired = false;

const formatDate = (iso) => new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });

const renderExistingShares = async () => {
  const section = document.getElementById('share-existing-section');
  const list = document.getElementById('share-existing-list');
  const shares = await api.get(
    `schedule-shares?profile=${encodeURIComponent(getAppState().activeProfile)}&scheduleName=${encodeURIComponent(currentScheduleName)}`
  );
  if (!shares || shares.length === 0) {
    section.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  section.classList.remove('hidden');
  list.innerHTML = shares
    .map((s) => {
      const target = s.personFilter ? escapeHtml(s.personFilter) : '全部人';
      const expiry = s.expiresAt ? `${formatDate(s.expiresAt)} 到期` : '永久有效';
      return `
      <li class="flex justify-between items-center">
        <span>${target}・${formatDate(s.createdAt)} 建立・${expiry}</span>
        <button class="revoke-share-btn text-red-500 hover:text-red-700 text-xs p-1" data-token="${escapeHtml(s.token)}">撤銷</button>
      </li>`;
    })
    .join('');
};

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
        await renderExistingShares();
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

  document.getElementById('share-existing-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.revoke-share-btn');
    if (!btn) return;
    if (btn.disabled) return;
    btn.disabled = true;
    const result = await api.delete(`schedule-shares/${btn.dataset.token}`);
    if (result) {
      showToast('已撤銷分享連結', 'success');
      await renderExistingShares();
    } else {
      btn.disabled = false;
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

  await renderExistingShares();
  document.getElementById('share-modal').classList.add('open');
}
