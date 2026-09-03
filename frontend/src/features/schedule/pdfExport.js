import { getGeneratedData, getEditingData } from '../../state/appState.js';
import { api } from '../../api/client.js';
import { showToast } from '../../ui/toast.js';
import { renderEditableSchedule } from './editableSchedule.js';

export async function printSchedule() {
  const generatedData = getGeneratedData();
  if (!generatedData) return;
  const scheduleOutput = document.getElementById('schedule-output');
  const wasEditing = getEditingData() !== null;
  try {
    const response = await api.post('render-schedule', generatedData);
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

export async function exportToPdf() {
  const generatedData = getGeneratedData();
  if (!generatedData) return;
  const scheduleOutput = document.getElementById('schedule-output');
  const wasEditing = getEditingData() !== null;
  try {
    const response = await api.post('render-schedule', generatedData);
    if (response?.html && scheduleOutput) scheduleOutput.innerHTML = response.html;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch (err) {
    console.error('載入預覽 HTML 失敗:', err);
    showToast('無法載入班表，請稍後再試', 'error');
    if (wasEditing) renderEditableSchedule();
    return;
  }

  const { jsPDF } = window.jspdf;
  const allScheduleElements = Array.from(document.querySelectorAll('[id^="schedule-week-"]'));
  const numWeeks = generatedData.length;

  let fontSize, headerFontSize, titleFontSize, padding, scaleValue;
  if (numWeeks === 1) { fontSize = 18; headerFontSize = 19; titleFontSize = 22; padding = 12; scaleValue = 1.8; }
  else if (numWeeks === 2) { fontSize = 15; headerFontSize = 16; titleFontSize = 19; padding = 10; scaleValue = 1.4; }
  else if (numWeeks <= 4) { fontSize = 14; headerFontSize = 15; titleFontSize = 17; padding = 8; scaleValue = 1.3; }
  else { fontSize = 12; headerFontSize = 13; titleFontSize = 15; padding = 6; scaleValue = 1.2; }

  const style = document.createElement('style');
  style.innerHTML = `
    .pdf-export-container { display: block; padding: ${padding}px; background: white; width: 1000px !important; min-width: 1000px !important; }
    .pdf-export-container .mb-8 { margin-bottom: ${padding}px !important; }
    .pdf-export-container h3 { font-size: ${titleFontSize}px !important; margin-bottom: ${padding / 2}px !important; font-weight: bold; }
    .pdf-export-container table { font-size: ${fontSize}px !important; width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important; }
    .pdf-export-container th, .pdf-export-container td { padding: ${padding}px !important; line-height: 1.4 !important; word-wrap: break-word !important; }
    .pdf-export-container th { font-size: ${headerFontSize}px !important; font-weight: bold !important; }
    .pdf-export-container .person-tag,
    .pdf-export-container .holiday-label { padding: 3px 10px !important; white-space: nowrap !important; }
  `;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.className = 'pdf-export-container';
  allScheduleElements.forEach((el) => container.appendChild(el.cloneNode(true)));
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  // Noto Sans TC 等 Google Fonts 用 font-display: swap 載入，若還沒切換完成就被
  // html2canvas 截圖，中文字會用 fallback 字型的寬度算版，跟 CSS 原本抓好的
  // pill padding 對不上，畫面上看起來就像文字被擠出格子邊界。等字型就緒 + 多等
  // 一次畫面重繪，確保截到的是真正套用目標字型之後的排版。
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    const canvas = await window.html2canvas(container, {
      scale: scaleValue,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
    });

    document.body.removeChild(container);
    document.head.removeChild(style);

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfPageWidth = pdf.internal.pageSize.getWidth();
    const pdfPageHeight = pdf.internal.pageSize.getHeight();
    const imgProps = pdf.getImageProperties(imgData);
    const margin = 5;
    const availableWidth = pdfPageWidth - margin * 2;
    const availableHeight = pdfPageHeight - margin * 2;

    let scale = availableWidth / imgProps.width;
    let pdfImageWidth = availableWidth;
    let pdfImageHeight = imgProps.height * scale;

    if (pdfImageHeight > availableHeight) {
      scale = availableHeight / imgProps.height;
      pdfImageHeight = availableHeight;
      pdfImageWidth = imgProps.width * scale;
    }

    const xPosition = margin;
    const yPosition = (pdfPageHeight - pdfImageHeight) / 2;
    pdf.addImage(imgData, 'JPEG', xPosition, yPosition, pdfImageWidth, pdfImageHeight);
    pdf.save('班表.pdf');
  } catch (err) {
    console.error('html2canvas failed:', err);
    showToast('PDF 導出失敗，請稍後再試', 'error');
    if (document.body.contains(container)) document.body.removeChild(container);
    if (document.head.contains(style)) document.head.removeChild(style);
  } finally {
    if (wasEditing) renderEditableSchedule();
  }
}
