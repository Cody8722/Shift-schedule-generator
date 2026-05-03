// 本地 escapeHtml（內部使用）
const escapeHtml = (unsafe) => {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const generateScheduleHtml = (fullScheduleData) => {
  // 加入 A4 直式版面的 CSS
  let html = `
<style>
@media print {
    @page {
        size: A4 portrait;
        margin: 10mm;
    }
    body {
        width: 210mm;
        min-height: 297mm;
    }
}
</style>
`;

  fullScheduleData.forEach((data, index) => {
    const { schedule, tasks, dateRange, weekDayDates, scheduleDays, color } = data;
    const weekDayNames = ['一', '二', '三', '四', '五'];
    // 驗證並清理顏色值（防止 CSS 注入）
    const safeHeaderColor = /^#[0-9a-fA-F]{6}$/.test(color.header) ? color.header : '#0284c7';
    const headerStyle = `style="background-color: ${safeHeaderColor}; color: white;"`;

    html += `
            <div class="mb-8" id="schedule-week-${index}">
                <h3 class="text-xl font-bold mb-2">第 ${index + 1} 週班表 (${escapeHtml(dateRange)})</h3>
                <table class="schedule-table">
                    <thead>
                        <tr>
                            <th ${headerStyle}>勤務地點</th>
                            ${weekDayDates
                              .map(
                                (date, i) =>
                                  `<th ${headerStyle}>星期${weekDayNames[i]}<br>(${escapeHtml(date)})</th>`
                              )
                              .join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${tasks
                          .map((task, taskIndex) => {
                            // 計算這個任務在整週中最多有幾位員工（決定需要幾列）
                            const maxPersonnel = Math.max(
                              ...weekDayDates.map((_, dayIndex) =>
                                scheduleDays[dayIndex].shouldSchedule
                                  ? schedule[dayIndex][taskIndex].length
                                  : 0
                              ),
                              1 // 至少一列
                            );

                            let taskRows = '';
                            for (let personIndex = 0; personIndex < maxPersonnel; personIndex++) {
                              taskRows += '<tr>';

                              if (personIndex === 0) {
                                taskRows += `<td class="font-medium align-middle" rowspan="${maxPersonnel}">${escapeHtml(task.name)}</td>`;
                              }

                              weekDayDates.forEach((_, dayIndex) => {
                                if (!scheduleDays[dayIndex].shouldSchedule) {
                                  if (personIndex === 0) {
                                    taskRows += `<td class="holiday-cell align-middle" rowspan="${maxPersonnel}">${escapeHtml(scheduleDays[dayIndex].description)}</td>`;
                                  }
                                } else {
                                  const personnel = schedule[dayIndex][taskIndex];
                                  const personName = personnel[personIndex] || '';
                                  taskRows += `<td class="align-middle">${escapeHtml(personName)}</td>`;
                                }
                              });

                              taskRows += '</tr>';
                            }
                            return taskRows;
                          })
                          .join('')}
                    </tbody>
                </table>
            </div>
        `;
  });
  return html;
};

module.exports = { generateScheduleHtml };
