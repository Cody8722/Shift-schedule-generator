const iconv = require('iconv-lite');
const debug = require('debug');

const debugServer = debug('app:server');

// 學校行事曆快取（6小時）
let schoolEventsCache = { data: null, fetchedAt: 0 };

// 自動計算當前學期代碼（民國年+學期，例：1142）
const getCurrentPeriod = () => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const rocYear = now.getFullYear() - 1911;
  if (month >= 8) return `${rocYear}1`;
  if (month === 1) return `${rocYear - 1}1`;
  return `${rocYear - 1}2`;
};

// 依學期代碼與月份推算西元年（避免跨年學期用錯年份）
const getYearForMonth = (month, period) => {
  const rocYear = parseInt(period.slice(0, -1)); // '1142' → 114
  const semester = parseInt(period.slice(-1));   // 1 或 2
  const baseYear = rocYear + 1911;               // 114 → 2025
  if (semester === 1) {
    // 第一學期：9–12 月在 baseYear，1 月在 baseYear+1
    return month >= 8 ? baseYear : baseYear + 1;
  }
  // 第二學期：2–7 月都在 baseYear+1
  return baseYear + 1;
};

// 以 Big5 解碼抓取網頁（8 秒 timeout）
const fetchBig5 = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const buffer = await resp.arrayBuffer();
    return iconv.decode(Buffer.from(buffer), 'big5');
  } finally {
    clearTimeout(timer);
  }
};

const getSchoolEvents = async () => {
  const CACHE_TTL = 6 * 60 * 60 * 1000; // 6小時
  if (schoolEventsCache.data && Date.now() - schoolEventsCache.fetchedAt < CACHE_TTL) {
    return { cached: true, data: schoolEventsCache.data };
  }

  const BASE = 'https://s44.mingdao.edu.tw/AACourses/Web/';
  const period = getCurrentPeriod();

  // 抓主頁面，找所有「重要考試」日期
  const mainHtml = await fetchBig5(`${BASE}eCalendar_view.php`);

  // 從 div 標籤萃取有「重要考試」的 qDate
  const examDates = new Set();
  const divTagRegex = /<div[^>]+id="sDB_[^"]*"[^>]*>/g;
  let tagMatch;
  while ((tagMatch = divTagRegex.exec(mainHtml)) !== null) {
    const tag = tagMatch[0];
    if (!tag.includes('重要考試')) continue;
    const qDateMatch = tag.match(/qDate="([^"]+)"/);
    if (qDateMatch) examDates.add(qDateMatch[1]);
  }

  // 逐日查詢詳細事件，找定期評量／期中考
  const seen = new Set();
  const events = [];

  for (const qDate of examDates) {
    let html;
    try {
      const encoded = encodeURIComponent(qDate);
      html = await fetchBig5(
        `${BASE}eCalendar_list.php?F_sPeriod=${period}&qDate=${encoded}&qDG=&qSpec=`
      );
    } catch {
      continue; // 單一日期查詢失敗時跳過，不影響其他日期
    }

    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let liMatch;
    while ((liMatch = liRegex.exec(html)) !== null) {
      const text = liMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if ((text.includes('定期評量') || text.includes('期中考')) && !seen.has(text)) {
        seen.add(text);
        // 支援同月 MM/DD~DD 與跨月 MM/DD~MM/DD 兩種格式
        const rangeMatch = text.match(/^(\d{2})\/(\d{2})(?:~(?:(\d{2})\/)?(\d{2}))?/);
        const nameMatch = text.match(/重要考試\s+(.+)$/);
        if (rangeMatch) {
          const startMonthNum = parseInt(rangeMatch[1]);
          const startYear = getYearForMonth(startMonthNum, period);
          const endMonthStr = rangeMatch[3] || rangeMatch[1]; // 若無跨月部分則同起始月
          const endDayStr = rangeMatch[4];
          const endMonthNum = parseInt(endMonthStr);
          // 跨年處理：結束月份小於起始月份表示跨入下一年（如 12→1）
          const endYear = endMonthNum < startMonthNum ? startYear + 1 : startYear;
          const startDate = `${startYear}${rangeMatch[1]}${rangeMatch[2]}`;
          const endDate = endDayStr
            ? `${endYear}${endMonthStr}${endDayStr}`
            : startDate;
          const fullName = nameMatch ? nameMatch[1].trim() : text;
          const ordinalMatch = fullName.match(/第([一二三四五六七八九十]+)次/);
          let shortName;
          if (ordinalMatch) {
            // 依事件原始名稱保留正確考試類型
            if (fullName.includes('定期評量')) shortName = `第${ordinalMatch[1]}次定期評量`;
            else if (fullName.includes('期末考'))  shortName = `第${ordinalMatch[1]}次期末考`;
            else if (fullName.includes('期中考'))  shortName = `第${ordinalMatch[1]}次期中考`;
            else                                   shortName = `第${ordinalMatch[1]}次考試`;
          } else {
            shortName = fullName;
          }
          events.push({ startDate, endDate, name: shortName, type: 'exam' });
        }
      }
    }
  }

  schoolEventsCache = { data: events, fetchedAt: Date.now() };
  return { cached: false, data: events };
};

module.exports = { getSchoolEvents };
