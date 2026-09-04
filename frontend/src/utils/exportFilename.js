import { getCurrentScheduleName } from '../state/appState.js';

const pad = (n) => String(n).padStart(2, '0');

const formatTimestamp = (date) =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

/**
 * 組合匯出檔名：已儲存班表名稱（若有，否則用 fallbackBase）_ 週次日期範圍 _ 匯出時間戳記.副檔名
 * 避免每次匯出都用同一個固定檔名，導致瀏覽器自動加 (1)(2)... 分不清是哪次匯出的內容。
 * @param {Array} exportData 目前要匯出的週資料（用來取日期範圍），可為 null/空陣列
 * @param {string} ext 副檔名（不含點），例如 'pdf'、'xlsx'
 * @param {{ suffix?: string, fallbackBase?: string, now?: Date }} [options]
 */
export const buildExportFilename = (exportData, ext, options = {}) => {
  const { suffix = '', fallbackBase = '班表', now = new Date() } = options;
  const scheduleName = getCurrentScheduleName();
  const parts = [(scheduleName || fallbackBase) + suffix];

  if (exportData && exportData.length > 0) {
    const firstRange = exportData[0].dateRange || '';
    const lastRange = exportData[exportData.length - 1].dateRange || '';
    const start = firstRange.split(' - ')[0]?.trim().replace(/\//g, '');
    const end = (lastRange.split(' - ')[1] || lastRange.split(' - ')[0])?.trim().replace(/\//g, '');
    if (start && end) parts.push(`${start}~${end}`);
  }

  parts.push(formatTimestamp(now));
  return `${parts.join('_')}.${ext}`;
};
