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

// 以 Big5 解碼抓取網頁
const fetchBig5 = async (url) => {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  return iconv.decode(Buffer.from(buffer), 'big5');
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
    const encoded = encodeURIComponent(qDate);
    const html = await fetchBig5(
      `${BASE}eCalendar_list.php?F_sPeriod=${period}&qDate=${encoded}&qDG=&qSpec=`
    );

    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let liMatch;
    while ((liMatch = liRegex.exec(html)) !== null) {
      const text = liMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if ((text.includes('定期評量') || text.includes('期中考')) && !seen.has(text)) {
        seen.add(text);
        const rangeMatch = text.match(/^(\d{2})\/(\d{2})(?:~(\d{2}))?/);
        const nameMatch = text.match(/重要考試\s+(.+)$/);
        if (rangeMatch) {
          const year = new Date().getFullYear();
          const startDate = `${year}${rangeMatch[1]}${rangeMatch[2]}`;
          const endDate = rangeMatch[3]
            ? `${year}${rangeMatch[1]}${rangeMatch[3]}`
            : startDate;
          const fullName = nameMatch ? nameMatch[1].trim() : text;
          const ordinalMatch = fullName.match(/第([一二三四五六七八九十]+)次/);
          const shortName = ordinalMatch ? `第${ordinalMatch[1]}次定期評量` : fullName;
          events.push({ startDate, endDate, name: shortName, type: 'exam' });
        }
      }
    }
  }

  schoolEventsCache = { data: events, fetchedAt: Date.now() };
  return { cached: false, data: events };
};

module.exports = { getSchoolEvents };
