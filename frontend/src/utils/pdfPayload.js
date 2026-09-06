import { PDFDocument } from 'pdf-lib';

const ENCRYPT_URL = 'api/pdf-payload/encrypt';
const DECRYPT_URL = 'api/pdf-payload/decrypt';
const MARKER = 'SCHEDPDF1:';

// 嵌入是「錦上添花」的功能：後端未設定 PDF_PAYLOAD_SECRET（回 503）或任何其他失敗都靜默
// 略過，不影響 PDF 本身的正常匯出，也刻意不用全域 api.post（那個會自動彈錯誤 toast，
// 每次匯出都跳警告會很擾人，但這功能沒設定本來就是允許的正常狀態）。
export async function buildKeywordsWithPayload(scheduleData) {
  try {
    const res = await fetch(ENCRYPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: scheduleData }),
    });
    if (!res.ok) return null;
    const { payload } = await res.json();
    return payload ? `${MARKER}${payload}` : null;
  } catch {
    return null;
  }
}

// 匯入是使用者主動觸發的操作，任何失敗都要清楚回報原因，不能靜默略過。
export async function extractScheduleFromPdfBytes(pdfBytes) {
  let keywords;
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    keywords = pdfDoc.getKeywords();
  } catch {
    return { ok: false, reason: '無法讀取此檔案，請確認是有效的 PDF 檔案' };
  }

  if (!keywords || !keywords.startsWith(MARKER)) {
    return { ok: false, reason: '此 PDF 沒有嵌入班表資料（可能不是本系統匯出的檔案）' };
  }

  const encryptedPayload = keywords.slice(MARKER.length);
  let res;
  try {
    res = await fetch(DECRYPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: encryptedPayload }),
    });
  } catch {
    return { ok: false, reason: '無法連線到伺服器，請稍後再試' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, reason: err.message || '無法解密此 PDF 的隱藏資料' };
  }

  const { data } = await res.json();
  return { ok: true, data };
}
