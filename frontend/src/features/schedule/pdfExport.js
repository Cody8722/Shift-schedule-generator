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
  const pdfPageWidth = pdf.internal.pageSize.getWidth();
  const pdfPageHeight = pdf.internal.pageSize.getHeight();
  const margin = 5;
  const availableWidth = pdfPageWidth - margin * 2;
  const availableHeight = pdfPageHeight - margin * 2;
  const targetAspect = availableWidth / availableHeight;

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

      // 容器寬度固定，週數越少內容天生越「扁」（比 A4 直向頁面更寬更矮）。與其事後
      // 把截好的圖硬拉伸（表頭、圓角標籤都會變形），改成截圖前先量出容器目前的長寬比，
      // 補上下（或左右）留白讓長寬比先貼近目標頁面，這樣文字/標籤本身完全不變形，
      // 之後用等比例縮放去填滿版面時才不會留下大片空白，也不會拉伸內容。
      const naturalWidth = container.offsetWidth;
      const naturalHeight = container.offsetHeight;
      const naturalAspect = naturalWidth / naturalHeight;
      if (naturalAspect > targetAspect) {
        const neededHeight = naturalWidth / targetAspect;
        const extraHeight = Math.max(0, neededHeight - naturalHeight);
        container.style.paddingTop = `${extraHeight / 2}px`;
        container.style.paddingBottom = `${extraHeight / 2}px`;
      } else if (naturalAspect < targetAspect) {
        const neededWidth = naturalHeight * targetAspect;
        const extraWidth = Math.max(0, neededWidth - naturalWidth);
        container.style.paddingLeft = `${extraWidth / 2}px`;
        container.style.paddingRight = `${extraWidth / 2}px`;
      }

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
      const imgProps = pdf.getImageProperties(imgData);
      // 截圖前已經把長寬比調整到接近 targetAspect，這裡用等比例縮放（不拉伸變形）
      // 幾乎就能剛好填滿整個可用版面。
      const scale = Math.min(availableWidth / imgProps.width, availableHeight / imgProps.height);
      const pdfImageWidth = imgProps.width * scale;
      const pdfImageHeight = imgProps.height * scale;

      if (renderedAnyPage) pdf.addPage();
      renderedAnyPage = true;

      const xPosition = margin + (availableWidth - pdfImageWidth) / 2;
      const yPosition = margin + (availableHeight - pdfImageHeight) / 2;
      pdf.addImage(imgData, 'JPEG', xPosition, yPosition, pdfImageWidth, pdfImageHeight);
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
