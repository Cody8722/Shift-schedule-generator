import { escapeHtml } from '../../utils/escapeHtml.js';

// 免登入的分享連結進來時，整個管理後台（側邊欄、設定、編輯功能）完全不應該出現——
// 這裡直接整個接管 document.body，不走 main.js 其餘的初始化流程。
export async function renderSharedViewIfPresent() {
  const token = new URLSearchParams(location.search).get('share');
  if (!token) return false;

  document.body.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:24px;font-family:system-ui,sans-serif;">
      <div id="shared-view-content">載入中...</div>
    </div>
  `;

  const contentEl = document.getElementById('shared-view-content');
  try {
    const res = await fetch(`api/schedule-shares/${encodeURIComponent(token)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      contentEl.textContent = err.message || '無法載入班表';
      return true;
    }
    const { html, scheduleName, personFilter } = await res.json();
    const heading = personFilter ? `${escapeHtml(personFilter)} 的班表` : escapeHtml(scheduleName);
    const subheading = personFilter
      ? `${escapeHtml(scheduleName)} · 僅顯示 ${escapeHtml(personFilter)}`
      : escapeHtml(scheduleName);
    contentEl.innerHTML = `
      <h2 style="margin:0 0 4px;">${heading}</h2>
      <div style="color:var(--text-muted,#78716c);font-size:13px;margin-bottom:16px;">${subheading}</div>
      ${html}
    `;
  } catch {
    contentEl.textContent = '無法連線到伺服器，請稍後再試';
  }
  return true;
}
