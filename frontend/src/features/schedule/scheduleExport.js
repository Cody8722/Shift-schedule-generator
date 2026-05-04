import { api } from '../../api/client.js';
import { showToast } from '../../ui/toast.js';
import { getGeneratedData } from '../../state/appState.js';

export const copySchedule = () => {
  const generatedData = getGeneratedData();
  if (!generatedData) return;
  let textContent = '';
  generatedData.forEach((data, index) => {
    const { schedule, tasks, dateRange, weekDayDates, scheduleDays } = data;
    textContent += `第 ${index + 1} 週班表 (${dateRange})\n`;
    textContent += ['勤務地點', '星期一', '星期二', '星期三', '星期四', '星期五'].join('\t') + '\n';
    tasks.forEach((task, taskIndex) => {
      let row = `${task.name}\t`;
      row += weekDayDates.map((_, dayIndex) => {
        if (!scheduleDays[dayIndex].shouldSchedule) return scheduleDays[dayIndex].description;
        return schedule[dayIndex][taskIndex].join(', ');
      }).join('\t');
      textContent += row + '\n';
    });
    textContent += '\n';
  });
  navigator.clipboard
    .writeText(textContent)
    .then(() => showToast('班表已複製！', 'success'))
    .catch(() => showToast('複製失敗！', 'error'));
};

export const exportToExcel = () => {
  const generatedData = getGeneratedData();
  if (!generatedData) return;
  const wb = window.XLSX.utils.book_new();
  generatedData.forEach((data, index) => {
    const { schedule, tasks, weekDayDates, scheduleDays } = data;
    const header = [
      '勤務地點',
      ...weekDayDates.map((date, i) => `星期${['一', '二', '三', '四', '五'][i]}\n(${date})`),
    ];
    const ws_data = [header];
    tasks.forEach((task, taskIndex) => {
      const row = [task.name];
      weekDayDates.forEach((_, dayIndex) => {
        if (!scheduleDays[dayIndex].shouldSchedule) {
          row.push(scheduleDays[dayIndex].description);
        } else {
          row.push(schedule[dayIndex][taskIndex].join('\n'));
        }
      });
      ws_data.push(row);
    });
    const ws = window.XLSX.utils.aoa_to_sheet(ws_data);
    ws['!cols'] = Array(6).fill({ wch: 15 });
    window.XLSX.utils.book_append_sheet(wb, ws, `第${index + 1}週`);
  });
  window.XLSX.writeFile(wb, '班表.xlsx');
};

export const printSchedule = async () => {
  const generatedData = getGeneratedData();
  if (!generatedData) return;
  try {
    const response = await api.post('render-schedule', generatedData);
    if (response?.html) document.getElementById('schedule-output').innerHTML = response.html;
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.print();
  } catch (err) {
    console.error('列印失敗:', err);
    showToast('列印失敗，請稍後再試', 'error');
  }
};

export const exportToPdf = async () => {
  const generatedData = getGeneratedData();
  if (!generatedData) return;
  try {
    const response = await api.post('render-schedule', generatedData);
    if (response?.html) document.getElementById('schedule-output').innerHTML = response.html;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch (err) {
    console.error('載入預覽 HTML 失敗:', err);
    showToast('無法載入班表，請稍後再試', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const allScheduleElements = Array.from(document.querySelectorAll('[id^="schedule-week-"]'));
  const numWeeks = generatedData.length;

  let fontSize, headerFontSize, titleFontSize, padding, scaleValue;
  if (numWeeks === 1)       { fontSize = 18; headerFontSize = 19; titleFontSize = 22; padding = 12; scaleValue = 1.8; }
  else if (numWeeks === 2)  { fontSize = 15; headerFontSize = 16; titleFontSize = 19; padding = 10; scaleValue = 1.4; }
  else if (numWeeks <= 4)   { fontSize = 14; headerFontSize = 15; titleFontSize = 17; padding = 8;  scaleValue = 1.3; }
  else                      { fontSize = 12; headerFontSize = 13; titleFontSize = 15; padding = 6;  scaleValue = 1.2; }

  const style = document.createElement('style');
  style.innerHTML = `
    .pdf-export-container { display: block; padding: ${padding}px; background: white; width: 1000px !important; min-width: 1000px !important; }
    .pdf-export-container .mb-8 { margin-bottom: ${padding}px !important; }
    .pdf-export-container h3 { font-size: ${titleFontSize}px !important; margin-bottom: ${padding / 2}px !important; font-weight: bold; }
    .pdf-export-container table { font-size: ${fontSize}px !important; width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important; }
    .pdf-export-container th, .pdf-export-container td { padding: ${padding}px !important; line-height: 1.4 !important; word-wrap: break-word !important; }
    .pdf-export-container th { font-size: ${headerFontSize}px !important; font-weight: bold !important; }
  `;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.className = 'pdf-export-container';
  allScheduleElements.forEach((el) => container.appendChild(el.cloneNode(true)));
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

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

    pdf.addImage(imgData, 'JPEG', margin, (pdfPageHeight - pdfImageHeight) / 2, pdfImageWidth, pdfImageHeight);
    pdf.save('班表.pdf');
  } catch (err) {
    console.error('html2canvas failed:', err);
    showToast('PDF 導出失敗，請稍後再試', 'error');
    if (document.body.contains(container)) document.body.removeChild(container);
    if (document.head.contains(style)) document.head.removeChild(style);
  }
};
