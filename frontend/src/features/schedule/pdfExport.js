import { getEditingData } from '../../state/appState.js';
import { getExportData } from './exportWeekFilter.js';
import { api } from '../../api/client.js';
import { showToast } from '../../ui/toast.js';
import { renderEditableSchedule } from './editableSchedule.js';

export async function printSchedule() {
  const exportData = getExportData();
  if (!exportData || exportData.length === 0) return;
  const scheduleOutput = document.getElementById('schedule-output');
  const wasEditing = getEditingData() !== null;
  try {
    const response = await api.post('render-schedule', exportData);
    if (response?.html && scheduleOutput) scheduleOutput.innerHTML = response.html;
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.print();
  } catch (err) {
    console.error('列印失敗:', err);
    showToast('列印失敗，請稍後再試', 'error');
  } finally {
    if (wasEditing) renderEditableSchedule();
  }
}

// 依「每頁週數」決定字級/間距——每頁週數越少，代表每週分到的版面越大，字可以更大
const PAGE_DENSITY_STYLES = {
  1: { fontSize: 18, headerFontSize: 19, titleFontSize: 22, padding: 12, scaleValue: 1.8 },
  2: { fontSize: 15, headerFontSize: 16, titleFontSize: 19, padding: 10, scaleValue: 1.4 },
  3: { fontSize: 14, headerFontSize: 15, titleFontSize: 17, padding: 8, scaleValue: 1.3 },
  4: { fontSize: 12, headerFontSize: 13, titleFontSize: 15, padding: 6, scaleValue: 1.2 },
};

export async function exportToPdf() {
  const exportData = getExportData();
  if (!exportData || exportData.length === 0) return;
  const scheduleOutput = document.getElementById('schedule-output');
  const wasEditing = getEditingData() !== null;
  try {
    const response = await api.post('render-schedule', exportData);
    if (response?.html && scheduleOutput) scheduleOutput.innerHTML = response.html;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch (err) {
    console.error('載入預覽 HTML 失敗:', err);
    showToast('無法載入班表，請稍後再試', 'error');
    if (wasEditing) renderEditableSchedule();
    return;
  }

  const { jsPDF } = window.jspdf;
  const weeksPerPageInput = parseInt(document.getElementById('weeks-per-page')?.value, 10);
  const weeksPerPage = Math.min(4, Math.max(1, weeksPerPageInput || 2));

  // Noto Sans TC 等 Google Fonts 用 font-display: swap 載入，若還沒切換完成就被
  // html2canvas 截圖，中文字會用 fallback 字型的寬度算版，跟 CSS 原本抓好的
  // pill padding 對不上，畫面上看起來就像文字被擠出格子邊界。等字型就緒 + 多等
  // 一次畫面重繪，確保截到的是真正套用目標字型之後的排版。
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const allScheduleElements = Array.from(document.querySelectorAll('[id^="schedule-week-"]'));
  // 依「每頁週數」把週區塊切成好幾頁，超過的自動排到下一頁（自動分頁補位）
  const pdfPages = [];
  for (let i = 0; i < allScheduleElements.length; i += weeksPerPage) {
    pdfPages.push(allScheduleElements.slice(i, i + weeksPerPage));
  }

  const pdf = new jsPDF('p', 'mm', 'a4');
  let renderedAnyPage = false;
  let activeContainer = null;
  let activeStyle = null;

  try {
    for (const pageElements of pdfPages) {
      // 依「這一頁實際的週數」決定字級/間距，而不是用整體的「每頁週數」設定——
      // 自動補位補到的最後一頁週數可能比設定值少（例如每頁 2 週但只剩 1 週），
      // 這樣那一頁才會真的放大填滿版面，而不是維持跟其他頁一樣的小尺寸。
      const density = PAGE_DENSITY_STYLES[Math.min(4, Math.max(1, pageElements.length))];
      const style = document.createElement('style');
      style.innerHTML = `
        .pdf-export-container { display: block; padding: ${density.padding}px; background: white; width: 1000px !important; min-width: 1000px !important; }
        .pdf-export-container .mb-8 { margin-bottom: ${density.padding}px !important; }
        .pdf-export-container h3 { font-size: ${density.titleFontSize}px !important; margin-bottom: ${density.padding / 2}px !important; font-weight: bold; }
        .pdf-export-container table { font-size: ${density.fontSize}px !important; width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important; }
        .pdf-export-container th, .pdf-export-container td { padding: ${density.padding}px !important; line-height: 1.4 !important; word-wrap: break-word !important; }
        .pdf-export-container th { font-size: ${density.headerFontSize}px !important; font-weight: bold !important; }
        .pdf-export-container .person-tag,
        .pdf-export-container .holiday-label { padding: 3px 10px !important; white-space: nowrap !important; }
      `;
      document.head.appendChild(style);
      activeStyle = style;

      const container = document.createElement('div');
      container.className = 'pdf-export-container';
      pageElements.forEach((el) => container.appendChild(el.cloneNode(true)));
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      document.body.appendChild(container);
      activeContainer = container;

      const canvas = await window.html2canvas(container, {
        scale: density.scaleValue,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
      });
      document.body.removeChild(container);
      activeContainer = null;
      document.head.removeChild(style);
      activeStyle = null;

      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const pdfPageWidth = pdf.internal.pageSize.getWidth();
      const pdfPageHeight = pdf.internal.pageSize.getHeight();
      const margin = 5;
      const availableWidth = pdfPageWidth - margin * 2;
      const availableHeight = pdfPageHeight - margin * 2;

      // 直接拉伸填滿整張可用版面，不嚴格保持長寬比——容器寬度固定，週數越少內容
      // 天生越「扁」，等比例縮放不管字級放多大都填不滿 A4 直向頁面的高度；拉伸後
      // 每列會變高一點，但表格內容本來就不怕這種程度的變形，比留一堆空白更好讀。
      if (renderedAnyPage) pdf.addPage();
      renderedAnyPage = true;

      pdf.addImage(imgData, 'JPEG', margin, margin, availableWidth, availableHeight);
    }

    pdf.save('班表.pdf');
  } catch (err) {
    console.error('html2canvas failed:', err);
    showToast('PDF 導出失敗，請稍後再試', 'error');
    if (activeContainer && document.body.contains(activeContainer)) document.body.removeChild(activeContainer);
    if (activeStyle && document.head.contains(activeStyle)) document.head.removeChild(activeStyle);
  } finally {
    if (wasEditing) renderEditableSchedule();
  }
}
