const iconv = require('iconv-lite');
const debug = require('debug');

const debugServer = debug('app:server');

// 學校行事曆快取（6小時）
let schoolEventsCache = { data: null, fetchedAt: 0 };


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

  // 只抓主頁面（1 個請求），直接從 qDate 屬性拿日期，不查各日 list 頁面
  const mainHtml = await fetchBig5(`${BASE}eCalendar_view.php`);

  const examDateSet = new Set();
  const divTagRegex = /<div[^>]+id="sDB_[^"]*"[^>]*>/g;
  let tagMatch;
  while ((tagMatch = divTagRegex.exec(mainHtml)) !== null) {
    const tag = tagMatch[0];
    if (!tag.includes('重要考試')) continue;
    // qDate 格式：D@YYYY/MM/DD
    const qDateMatch = tag.match(/qDate="D@(\d{4})\/(\d{2})\/(\d{2})"/);
    if (qDateMatch) {
      const [, y, m, d] = qDateMatch;
      examDateSet.add(`${y}${m}${d}`);
    }
  }

  // 將離散日期合併成連續範圍
  const sortedDates = [...examDateSet].sort();
  const events = [];
  let rangeStart = null;
  let rangeEnd = null;

  const advanceDate = (yyyymmdd) => {
    const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)));
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  };

  for (const dateStr of sortedDates) {
    if (!rangeStart) {
      rangeStart = rangeEnd = dateStr;
    } else if (dateStr === advanceDate(rangeEnd)) {
      rangeEnd = dateStr;
    } else {
      events.push({ startDate: rangeStart, endDate: rangeEnd, name: '重要考試', type: 'exam' });
      rangeStart = rangeEnd = dateStr;
    }
  }
  if (rangeStart) {
    events.push({ startDate: rangeStart, endDate: rangeEnd, name: '重要考試', type: 'exam' });
  }

  schoolEventsCache = { data: events, fetchedAt: Date.now() };
  return { cached: false, data: events };
};

module.exports = { getSchoolEvents };
