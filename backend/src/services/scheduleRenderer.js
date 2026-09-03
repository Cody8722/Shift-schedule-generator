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
  let html = `
<style>
@media print {
    @page { size: A4 portrait; margin: 10mm; }
    body { width: 210mm; min-height: 297mm; }
    .week-block { break-inside: avoid; }
}
</style>
`;

  fullScheduleData.forEach((data, index) => {
    const { schedule, tasks, dateRange, weekDayDates, scheduleDays } = data;
    // 匯出時可能只送選定的幾週，weekIndex 保留該週在完整班表中的原始序號，
    // 讓 W 標籤跟格子 id 不會因為篩選而錯位；沒有這個欄位的舊資料退回用陣列位置。
    const weekNum = data.weekIndex ?? index;
    const weekDayNames = ['一', '二', '三', '四', '五'];

    const workDays = scheduleDays.filter((d) => d.shouldSchedule).length;
    const demand = tasks.reduce((s, t) => s + t.count, 0) * workDays;
    const filled = tasks.reduce((s, task, ti) =>
      s + scheduleDays.reduce((a, day, di) =>
        a + (day.shouldSchedule ? schedule[di][ti].length : 0), 0), 0);
    const pct = demand > 0 ? Math.round(filled / demand * 100) : 100;
    const fillClass = pct >= 100 ? 'ok' : 'warn';

    const theadCols = weekDayDates.map((date, i) =>
      `<th><span class="dow">星期${weekDayNames[i]}</span><span class="date">${escapeHtml(date)}</span></th>`
    ).join('');

    const tbodyRows = tasks.map((task, taskIndex) => {
      const maxPersonnel = Math.max(
        ...weekDayDates.map((_, dayIndex) =>
          scheduleDays[dayIndex].shouldSchedule ? schedule[dayIndex][taskIndex].length : 0
        ),
        1
      );
      const priorityCls = `p${task.priority || 9}`;
      let rows = '';
      for (let pi = 0; pi < maxPersonnel; pi++) {
        rows += '<tr>';
        if (pi === 0) {
          rows += `<td class="task-cell" rowspan="${maxPersonnel}">
            <span class="priority-dot ${priorityCls}"></span>${escapeHtml(task.name)}
            <span class="task-meta">需 ${task.count} · P${task.priority || 9}</span>
          </td>`;
        }
        weekDayDates.forEach((_, dayIndex) => {
          if (!scheduleDays[dayIndex].shouldSchedule) {
            if (pi === 0) {
              rows += `<td class="holiday-cell" rowspan="${maxPersonnel}">
                <span class="holiday-label">${escapeHtml(scheduleDays[dayIndex].description)}</span>
              </td>`;
            }
          } else {
            const personName = schedule[dayIndex][taskIndex][pi] || '';
            if (personName) {
              rows += `<td><div class="persons"><span class="person-tag">${escapeHtml(personName)}</span></div></td>`;
            } else {
              rows += `<td class="warn-cell"><div class="persons"><span class="person-tag unfilled">＋ 待補</span></div></td>`;
            }
          }
        });
        rows += '</tr>';
      }
      return rows;
    }).join('');

    html += `
<div class="week-block" id="schedule-week-${weekNum}">
  <div class="week-head">
    <div class="week-label">
      <span class="week-num">W${weekNum + 1}</span>
      <span class="week-date">${escapeHtml(dateRange)}</span>
    </div>
    <div class="week-stats">填補 <span class="${fillClass}">${filled}/${demand}</span> · ${pct}%</div>
  </div>
  <table class="s-table">
    <thead><tr>
      <th style="text-align:left; padding-left: 16px;">勤務</th>
      ${theadCols}
    </tr></thead>
    <tbody>${tbodyRows}</tbody>
  </table>
</div>
`;
  });

  return html;
};

module.exports = { generateScheduleHtml };
