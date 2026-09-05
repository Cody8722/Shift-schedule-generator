/**
 * 顯示輸入 Modal，回傳使用者輸入的字串（或 null 表示取消）。
 * @param {string} title
 * @param {string} defaultValue
 * @returns {Promise<string|null>}
 */
export const showInput = (title, defaultValue = '') => {
  return new Promise((resolve) => {
    document.getElementById('input-modal-title').textContent = title;
    const field = document.getElementById('input-modal-field');
    field.value = defaultValue;
    document.getElementById('input-modal').classList.add('open');
    setTimeout(() => {
      field.focus();
      field.select();
    }, 50);

    const onConfirm = () => {
      cleanup();
      resolve(field.value.trim() || null);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const onKeydown = (e) => {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    };

    function cleanup() {
      document.getElementById('input-modal').classList.remove('open');
      document.getElementById('input-modal-confirm').removeEventListener('click', onConfirm);
      document.getElementById('input-modal-cancel').removeEventListener('click', onCancel);
      field.removeEventListener('keydown', onKeydown);
    }

    document.getElementById('input-modal-confirm').addEventListener('click', onConfirm);
    document.getElementById('input-modal-cancel').addEventListener('click', onCancel);
    field.addEventListener('keydown', onKeydown);
  });
};

/**
 * 顯示確認 Modal，回傳 true（確認）或 false（取消）。
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export const showConfirm = (message) => {
  return new Promise((resolve) => {
    document.getElementById('confirm-modal-message').textContent = message;
    document.getElementById('confirm-modal').classList.add('open');

    const onOk = () => {
      cleanup();
      resolve(true);
    };
    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    // showInput 的輸入框本來就有 Enter 送出，這裡也補上讓兩種通用 Modal 的鍵盤操作一致
    // （原本完全沒有鍵盤支援，連最基本的 Enter 確認都要用滑鼠點）。Escape 由全域的
    // Modal 監聽器統一處理，這裡不重複做。
    const onKeydown = (e) => {
      if (e.key === 'Enter') onOk();
    };

    function cleanup() {
      document.getElementById('confirm-modal').classList.remove('open');
      document.getElementById('confirm-modal-ok').removeEventListener('click', onOk);
      document.getElementById('confirm-modal-cancel').removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeydown);
    }

    document.getElementById('confirm-modal-ok').addEventListener('click', onOk);
    document.getElementById('confirm-modal-cancel').addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeydown);
  });
};
