import { escapeHtml } from '../../utils/escapeHtml.js';
import { getAppState, getEditingData, getGeneratedData } from '../../state/appState.js';

export const TASK_COLORS = [
  'pv-task-0',
  'pv-task-1',
  'pv-task-2',
  'pv-task-3',
  'pv-task-4',
  'pv-task-5',
];

/**
 * 渲染人員視角表格到 #personnel-view。
 * @param {Array} data fullScheduleData
 */
export const renderPersonnelView = (data) => {
  const panel = document.getElementById('personnel-view');
  if (!panel || !data || !data.length) return;

  const dayNames = ['一', '二', '三', '四', '五'];
  const allTasks = data[0].tasks.map((t) => t.name);
  const taskColorMap = {};
  allTasks.forEach((name, i) => {
    taskColorMap[name] = TASK_COLORS[i % TASK_COLORS.length];
  });

  const appState = getAppState();
  const personnel =
    appState.profiles[appState.activeProfile]?.settings?.personnel || [];
  const allPersons = personnel.map((p) => p.name);

  // 收集所有 header 欄
  const cols = [];
  data.forEach((week, wi) => {
    week.weekDayDates.forEach((date, di) => {
      cols.push({
        label: `W${wi + 1}<br><span class='text-xs font-normal'>${dayNames[di]}<br>${escapeHtml(date)}</span>`,
        wi,
        di,
        shouldSchedule: week.scheduleDays[di].shouldSchedule,
      });
    });
  });

  // 建立 person → col key → task name
  const personMap = {};
  allPersons.forEach((p) => {
    personMap[p] = {};
  });
  data.forEach((week, wi) => {
    week.schedule.forEach((daySlots, di) => {
      daySlots.forEach((persons, ti) => {
        persons.forEach((p) => {
          if (!personMap[p]) personMap[p] = {};
          personMap[p][`${wi}-${di}`] = week.tasks[ti].name;
        });
      });
    });
  });

  const thStyle =
    'px-2 py-1 text-center text-xs font-medium pv-th min-w-[60px]';
  const tdStyle = 'px-1 py-1 text-center text-xs pv-td';
  const header = `<tr><th class="${thStyle} sticky left-0 z-10 min-w-[80px]">姓名</th>${cols
    .map(
      (c) =>
        `<th class="${thStyle}">${
          c.shouldSchedule
            ? c.label
            : `<span class='text-gray-400'>${c.label}</span>`
        }</th>`
    )
    .join('')}</tr>`;

  const rows = allPersons
    .map((p) => {
      const cells = cols
        .map((c) => {
          if (!c.shouldSchedule) return `<td class="${tdStyle} pv-holiday">—</td>`;
          const task = personMap[p]?.[`${c.wi}-${c.di}`];
          return task
            ? `<td class="${tdStyle} ${taskColorMap[task] || ''} font-medium">${escapeHtml(task)}</td>`
            : `<td class="${tdStyle}"></td>`;
        })
        .join('');
      return `<tr><td class="${tdStyle} sticky left-0 z-10 pv-name font-medium">${escapeHtml(p)}</td>${cells}</tr>`;
    })
    .join('');

  panel.innerHTML = `<table class="border-collapse text-sm w-max"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
};

/**
 * 匯出人員班表為 Excel。
 */
export const exportPersonnelExcel = () => {
  const data = getEditingData() || getGeneratedData();
  if (!data) return;

  const dayNames = ['一', '二', '三', '四', '五'];
  const appState = getAppState();
  const personnel =
    appState.profiles[appState.activeProfile]?.settings?.personnel || [];
  const allPersons = personnel.map((p) => p.name);

  const cols = [];
  data.forEach((week, wi) => {
    week.weekDayDates.forEach((date, di) => {
      cols.push({
        label: `W${wi + 1}${dayNames[di]}(${date})`,
        wi,
        di,
        shouldSchedule: week.scheduleDays[di].shouldSchedule,
      });
    });
  });

  const personMap = {};
  allPersons.forEach((p) => {
    personMap[p] = {};
  });
  data.forEach((week, wi) => {
    week.schedule.forEach((daySlots, di) => {
      daySlots.forEach((persons, ti) => {
        persons.forEach((p) => {
          if (!personMap[p]) personMap[p] = {};
          personMap[p][`${wi}-${di}`] = week.tasks[ti].name;
        });
      });
    });
  });

  const header = ['姓名', ...cols.map((c) => c.label)];
  const wsData = [
    header,
    ...allPersons.map((p) => [
      p,
      ...cols.map((c) =>
        c.shouldSchedule ? personMap[p]?.[`${c.wi}-${c.di}`] || '' : '假日'
      ),
    ]),
  ];

  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 10 }, ...cols.map(() => ({ wch: 12 }))];
  window.XLSX.utils.book_append_sheet(wb, ws, '人員班表');
  window.XLSX.writeFile(wb, '人員班表.xlsx');
};
