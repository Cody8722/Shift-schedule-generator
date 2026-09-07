import { setGeneratedData, setCurrentScheduleName, getAppState, setAppState } from '../../state/appState.js';
import { extractScheduleFromPdfBytes } from '../../utils/pdfPayload.js';
import { api } from '../../api/client.js';
import { showToast } from '../../ui/toast.js';
import { showConfirm, showInput } from '../../ui/modal.js';
import { renderAll } from '../settings/settingsRenderer.js';
import { displaySchedule } from './scheduleGenerator.js';

// 匯出時的隱藏資料格式是 { schedule, settings }；改版前（舊格式）匯出的 PDF
// 沒有這層包裝，data 本身就是班表陣列——沒有 settings 可還原，只還原班表。
export const splitPayload = (data) => {
  if (Array.isArray(data)) return { schedule: data, settings: null };
  return { schedule: data?.schedule ?? null, settings: data?.settings ?? null };
};

// PDF 內含設定檔時，問使用者要套用到目前設定檔，還是另外建立一個新的；
// 都不要就維持原設定檔不動（僅還原班表）。重新抓一次 profiles 列表＋重繪，
// 讓左側設定檔/人員/勤務 UI 跟後端同步（不呼叫 main.js 的 initApp，避免
// 循環 import 和重複啟動狀態檢查計時器等 initApp 專屬的一次性副作用）。
const applyImportedSettings = async (settings) => {
  const applyToCurrent = await showConfirm(
    `這份 PDF 內含設定檔（人員/勤務設定），要套用到目前的設定檔「${getAppState().activeProfile}」嗎？`
  );

  if (applyToCurrent) {
    await api.put(`profiles/${getAppState().activeProfile}`, { settings });
    showToast('已套用設定檔內容', 'success');
  } else {
    const name = await showInput('建立新設定檔', '');
    if (!name) return;
    if (getAppState().profiles[name]) {
      showToast('該名稱已存在，設定檔內容未套用（僅還原班表）', 'warning');
      return;
    }
    const created = await api.post('profiles', { name, settings });
    if (!created) return;
    await api.put('profiles/active', { name });
    showToast(`已建立設定檔「${name}」`, 'success');
  }

  const data = await api.get('profiles');
  if (data?.profiles) {
    setAppState({ activeProfile: data.activeProfile, profiles: data.profiles });
    sessionStorage.setItem('activeProfile', data.activeProfile);
    renderAll();
  }
};

// 從一份由本系統匯出的 PDF 檔案讀出隱藏（加密）的班表資料並還原到畫面上，
// 效果等同重新產生一份班表：不綁定任何已儲存班表名稱，使用者可另外選擇「儲存班表」。
export async function importScheduleFromPdfFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await extractScheduleFromPdfBytes(new Uint8Array(arrayBuffer));
  if (!result.ok) {
    showToast(result.reason, 'error');
    return;
  }

  const { schedule, settings } = splitPayload(result.data);
  if (settings) {
    await applyImportedSettings(settings);
  }

  setGeneratedData(schedule);
  setCurrentScheduleName(null);
  const response = await api.post('render-schedule', schedule);
  if (response?.html) {
    displaySchedule(response.html);
    showToast('已從 PDF 匯入班表！', 'success');
  }
}
