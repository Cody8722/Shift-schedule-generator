import { setGeneratedData, setCurrentScheduleName } from '../../state/appState.js';
import { extractScheduleFromPdfBytes } from '../../utils/pdfPayload.js';
import { api } from '../../api/client.js';
import { showToast } from '../../ui/toast.js';
import { displaySchedule } from './scheduleGenerator.js';

// 從一份由本系統匯出的 PDF 檔案讀出隱藏（加密）的班表資料並還原到畫面上，
// 效果等同重新產生一份班表：不綁定任何已儲存班表名稱，使用者可另外選擇「儲存班表」。
export async function importScheduleFromPdfFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await extractScheduleFromPdfBytes(new Uint8Array(arrayBuffer));
  if (!result.ok) {
    showToast(result.reason, 'error');
    return;
  }

  setGeneratedData(result.data);
  setCurrentScheduleName(null);
  const response = await api.post('render-schedule', result.data);
  if (response?.html) {
    displaySchedule(response.html);
    showToast('已從 PDF 匯入班表！', 'success');
  }
}
