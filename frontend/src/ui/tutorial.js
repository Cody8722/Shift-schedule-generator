const STORAGE_KEY = 'tutorialDone_v1';

const STEPS = [
  {
    title: '歡迎使用智慧排班系統 👋',
    body: '這個簡短教學將帶您了解如何快速產生一份班表，大約需要 1 分鐘。',
    target: null,
    align: 'center',
  },
  {
    title: '① 選擇設定檔',
    body: '每個設定檔獨立儲存一套勤務與人員設定。點選下拉選單可切換設定檔，或點「新增」建立新的排班設定。',
    target: '[data-section="0"]',
    align: 'right',
  },
  {
    title: '② 設定勤務',
    body: '新增工作項目（例如「早班」），設定每天需要的人數。優先數字越小的勤務，系統會優先排滿。',
    target: '[data-section="1"]',
    align: 'right',
  },
  {
    title: '③ 新增人員',
    body: '輸入人員姓名並設定每週最多出勤次數。點擊 ⚙️ 可額外設定固定休假日或偏好勤務。',
    target: '[data-section="2"]',
    align: 'right',
  },
  {
    title: '④ 產生班表',
    body: '設定開始週次和週數，點「產生智慧班表」。系統會依優先序與公平性自動分配所有勤務，也可設定假日是否排班。',
    target: '[data-section="3"]',
    align: 'right',
  },
  {
    title: '⑤ 編輯與儲存班表',
    body: '班表產生後可直接進入編輯：\n・拖曳標籤可移動人員\n・點擊格子或「＋ 待補」可新增人員\n・按 × 可移除人員\n\n確認後點「儲存修改」，或用「儲存」另存新名稱。',
    target: null,
    align: 'center',
  },
];

let currentStep = 0;
let overlayEl = null;
let cardEl = null;
let prevHighlighted = null;

function injectStyles() {
  if (document.getElementById('tutorial-styles')) return;
  const style = document.createElement('style');
  style.id = 'tutorial-styles';
  style.textContent = `
    #tutorial-overlay {
      position: fixed; inset: 0; z-index: 9990;
      background: rgba(0,0,0,0.55);
      pointer-events: all;
      transition: opacity 0.25s;
    }
    #tutorial-card {
      position: fixed; z-index: 10000;
      background: var(--bg-surface, #fff);
      border: 1px solid var(--border-subtle, #e5e7eb);
      border-radius: 12px;
      padding: 20px 22px 16px;
      width: 300px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.22);
      pointer-events: all;
      transition: top 0.3s, left 0.3s, transform 0.3s;
    }
    #tutorial-card .t-progress {
      display: flex; gap: 5px; margin-bottom: 14px;
    }
    #tutorial-card .t-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--border-subtle, #e5e7eb);
      transition: background 0.2s;
    }
    #tutorial-card .t-dot.active {
      background: #3b82f6;
      width: 18px; border-radius: 3px;
    }
    #tutorial-card .t-title {
      font-size: 15px; font-weight: 700;
      margin-bottom: 8px;
      color: var(--text-primary, #111);
    }
    #tutorial-card .t-body {
      font-size: 13px; line-height: 1.65;
      color: var(--text-secondary, #555);
      white-space: pre-line;
      margin-bottom: 16px;
    }
    #tutorial-card .t-footer {
      display: flex; align-items: center; justify-content: space-between;
    }
    #tutorial-card .t-skip {
      font-size: 12px; color: var(--text-faint, #aaa);
      background: none; border: none; cursor: pointer; padding: 0;
    }
    #tutorial-card .t-skip:hover { color: var(--text-secondary, #666); }
    #tutorial-card .t-nav { display: flex; gap: 8px; }
    #tutorial-card .t-btn {
      font-size: 13px; font-weight: 600;
      padding: 7px 16px; border-radius: 8px; cursor: pointer; border: none;
    }
    #tutorial-card .t-btn-secondary {
      background: var(--bg-surface-2, #f3f4f6);
      color: var(--text-secondary, #555);
    }
    #tutorial-card .t-btn-secondary:hover { background: var(--bg-hover, #e9eaec); }
    #tutorial-card .t-btn-primary {
      background: #3b82f6; color: #fff;
    }
    #tutorial-card .t-btn-primary:hover { background: #2563eb; }
    .tutorial-highlight {
      position: relative !important;
      z-index: 9995 !important;
      border-radius: 8px !important;
      outline: 2px solid #3b82f6 !important;
      outline-offset: 3px !important;
      transition: outline 0.2s !important;
    }
  `;
  document.head.appendChild(style);
}

function removeHighlight() {
  if (prevHighlighted) {
    prevHighlighted.classList.remove('tutorial-highlight');
    prevHighlighted = null;
  }
}

function applyHighlight(selector) {
  removeHighlight();
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  el.classList.add('tutorial-highlight');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  prevHighlighted = el;
  return el;
}

function positionCard(targetEl, align) {
  if (!cardEl) return;
  const GAP = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = 300;

  if (!targetEl || align === 'center') {
    cardEl.style.top = '50%';
    cardEl.style.left = '50%';
    cardEl.style.transform = 'translate(-50%, -50%)';
    return;
  }

  cardEl.style.transform = '';
  const r = targetEl.getBoundingClientRect();
  const ch = cardEl.offsetHeight || 220;

  let top = Math.max(GAP, Math.min(r.top, vh - ch - GAP));
  let left;
  if (align === 'right') {
    left = Math.min(r.right + GAP, vw - cw - GAP);
  } else {
    left = Math.max(GAP, r.left - cw - GAP);
  }

  cardEl.style.top = `${top}px`;
  cardEl.style.left = `${left}px`;
}

function renderCard(stepIndex) {
  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const totalDots = STEPS.length;

  const dots = STEPS.map((_, i) =>
    `<span class="t-dot ${i === stepIndex ? 'active' : ''}"></span>`
  ).join('');

  cardEl.innerHTML = `
    <div class="t-progress">${dots}</div>
    <div class="t-title">${step.title}</div>
    <div class="t-body">${step.body}</div>
    <div class="t-footer">
      <button class="t-skip" id="t-skip">跳過教學</button>
      <div class="t-nav">
        ${!isFirst ? `<button class="t-btn t-btn-secondary" id="t-prev">← 上一步</button>` : ''}
        ${!isLast
          ? `<button class="t-btn t-btn-primary" id="t-next">下一步 →</button>`
          : `<button class="t-btn t-btn-primary" id="t-done">開始使用 🎉</button>`}
      </div>
    </div>
  `;

  document.getElementById('t-skip')?.addEventListener('click', closeTutorial);
  document.getElementById('t-prev')?.addEventListener('click', () => goToStep(stepIndex - 1));
  document.getElementById('t-next')?.addEventListener('click', () => goToStep(stepIndex + 1));
  document.getElementById('t-done')?.addEventListener('click', closeTutorial);
}

function goToStep(index) {
  currentStep = index;
  const step = STEPS[index];
  const targetEl = applyHighlight(step.target);
  renderCard(index);

  // re-position after a tick so new card height is known
  requestAnimationFrame(() => positionCard(targetEl, step.align));
}

function closeTutorial() {
  removeHighlight();
  overlayEl?.remove();
  cardEl?.remove();
  overlayEl = null;
  cardEl = null;
  localStorage.setItem(STORAGE_KEY, '1');
}

export function initTutorial() {
  if (localStorage.getItem(STORAGE_KEY)) return;
  injectStyles();

  overlayEl = document.createElement('div');
  overlayEl.id = 'tutorial-overlay';
  document.body.appendChild(overlayEl);

  cardEl = document.createElement('div');
  cardEl.id = 'tutorial-card';
  document.body.appendChild(cardEl);

  // slight delay so the page finishes rendering first
  setTimeout(() => goToStep(0), 600);
}

export function resetTutorial() {
  localStorage.removeItem(STORAGE_KEY);
}
