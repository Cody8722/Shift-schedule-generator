import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn(),
  },
}));

import { PDFDocument } from 'pdf-lib';
import { buildKeywordsWithPayload, extractScheduleFromPdfBytes } from './pdfPayload.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildKeywordsWithPayload', () => {
  it('加密成功時回傳帶標記前綴的字串', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ payload: 'abc123' }) });
    expect(await buildKeywordsWithPayload([{ week: 1 }])).toBe('SCHEDPDF1:abc123');
  });

  it('後端回傳非 2xx（如未設定金鑰）時回傳 null，不影響匯出', async () => {
    fetch.mockResolvedValue({ ok: false, json: async () => ({ message: '未設定' }) });
    expect(await buildKeywordsWithPayload([{ week: 1 }])).toBeNull();
  });

  it('fetch 拋出網路錯誤時回傳 null，不影響匯出', async () => {
    fetch.mockRejectedValue(new Error('network down'));
    expect(await buildKeywordsWithPayload([{ week: 1 }])).toBeNull();
  });

  it('後端回傳空 payload 時回傳 null', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ payload: '' }) });
    expect(await buildKeywordsWithPayload([{ week: 1 }])).toBeNull();
  });
});

describe('extractScheduleFromPdfBytes', () => {
  beforeEach(() => {
    PDFDocument.load.mockReset();
  });

  it('PDF 無法解析時回傳失敗原因', async () => {
    PDFDocument.load.mockRejectedValue(new Error('not a pdf'));
    const result = await extractScheduleFromPdfBytes(new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/無法讀取/);
  });

  it('PDF 沒有嵌入標記時回傳失敗原因', async () => {
    PDFDocument.load.mockResolvedValue({ getKeywords: () => undefined });
    const result = await extractScheduleFromPdfBytes(new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/沒有嵌入班表資料/);
  });

  it('keywords 存在但不是本系統標記時回傳失敗原因', async () => {
    PDFDocument.load.mockResolvedValue({ getKeywords: () => '一般文件關鍵字' });
    const result = await extractScheduleFromPdfBytes(new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(false);
  });

  it('有標記但後端解密失敗時回傳後端的錯誤訊息', async () => {
    PDFDocument.load.mockResolvedValue({ getKeywords: () => 'SCHEDPDF1:xyz' });
    fetch.mockResolvedValue({ ok: false, json: async () => ({ message: '內容已損毀' }) });
    const result = await extractScheduleFromPdfBytes(new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('內容已損毀');
  });

  it('成功解密時回傳還原的班表資料', async () => {
    PDFDocument.load.mockResolvedValue({ getKeywords: () => 'SCHEDPDF1:xyz' });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ week: 1 }] }) });
    const result = await extractScheduleFromPdfBytes(new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([{ week: 1 }]);
  });

  it('fetch 網路錯誤時回傳清楚的錯誤原因', async () => {
    PDFDocument.load.mockResolvedValue({ getKeywords: () => 'SCHEDPDF1:xyz' });
    fetch.mockRejectedValue(new Error('network down'));
    const result = await extractScheduleFromPdfBytes(new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/無法連線/);
  });
});
