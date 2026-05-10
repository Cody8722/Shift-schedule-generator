import { showToast } from '../ui/toast.js';

const API_BASE_URL = 'api';

/**
 * API 客戶端，封裝四種 HTTP 方法。
 * 每個方法在失敗時顯示 toast 並回傳 null。
 */
export const api = {
  get: async (endpoint) => {
    try {
      const response = await fetch(`${API_BASE_URL}/${endpoint}`);
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errData.message || `HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Fetch error for ${endpoint}:`, error);
      showToast(`無法讀取資料: ${error.message}`, 'error');
      return null;
    }
  },

  post: async (endpoint, body) => {
    try {
      const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errData.message || `HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`POST error for ${endpoint}:`, error);
      showToast(`操作失敗: ${error.message}`, 'error');
      return null;
    }
  },

  put: async (endpoint, body) => {
    try {
      const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errData.message || `HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`PUT error for ${endpoint}:`, error);
      showToast(`操作失敗: ${error.message}`, 'error');
      return null;
    }
  },

  delete: async (endpoint) => {
    try {
      const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errData.message || `HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`DELETE error for ${endpoint}:`, error);
      showToast(`操作失敗: ${error.message}`, 'error');
      return null;
    }
  },
};
