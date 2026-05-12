const iconv = require('iconv-lite');
const debug = require('debug');
const { getIsDbConnected, getSchoolEventsCollection } = require('../db/connect');

const debugServer = debug('app:server');

const MONGO_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

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

// 依學期代碼與月份推算西元年
const getYearForMonth = (month, period) => {
  const rocYear = parseInt(period.slice(0, -1));
  const semester = parseInt(period.slice(-1));
  const baseYear = rocYear + 1911;
  if (semester === 1) return month >= 8 ? baseYear : baseYear + 1;
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

// 判斷是否為高中／技高考試（排除國中部與國際部）
const isHighSchoolExam = (name) => {
  if (name.includes('高中部') || name.includes('高級部') || name.includes('普高')) return true;
  if (name.includes('技高')) return true;
  if (name.includes('高一') || name.includes('高二') || name.includes('高三')) return true;
  return false;
};

// 只保留定期評量、期中考、期末考（排除部份科目補考等非全體考試）
const isRelevantExamType = (name) => {
  if (name.includes('部份科目') || name.includes('補考') || name.includes('畢業考')) return false;
  return name.includes('定期評量') || name.includes('期中考') || name.includes('期末考');
};

const getCleanExamName = (rawName) => {
  if (rawName.includes('期末')) return '期末考';
  if (rawName.includes('第一') || rawName.includes('一次')) return '一段';
  if (rawName.includes('第二') || rawName.includes('二次')) return '二段';
  if (rawName.includes('第三') || rawName.includes('三次')) return '三段';
  if (rawName.includes('第四') || rawName.includes('四次')) return '四段';
  if (rawName.includes('期中')) return '期中考';
  return '定期評量';
};

const advanceDate = (yyyymmdd) => {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};

const getSchoolEvents = async () => {
  const CACHE_TTL = 6 * 60 * 60 * 1000; // 6小時
  if (schoolEventsCache.data && Date.now() - schoolEventsCache.fetchedAt < CACHE_TTL) {
    return { cached: true, data: schoolEventsCache.data };
  }

  const BASE = 'https://s44.mingdao.edu.tw/AACourses/Web/';
  const period = getCurrentPeriod();

  // 查 MongoDB 持久快取（7 天內有效）
  if (getIsDbConnected()) {
    try {
      const doc = await getSchoolEventsCollection().findOne({ _id: period });
      if (doc && Date.now() - doc.fetchedAt < MONGO_TTL_MS) {
        schoolEventsCache = { data: doc.events, fetchedAt: doc.fetchedAt };
        debugServer('school events loaded from MongoDB cache (period: %s)', period);
        return { cached: true, data: doc.events };
      }
    } catch (e) {
      debugServer('MongoDB school events cache read failed: %s', e.message);
    }
  }
  const rocYear = parseInt(period.slice(0, -1));
  const semester = parseInt(period.slice(-1));
  const baseYear = rocYear + 1911;

  // 依學期決定要查哪幾個月（只查有考試的月份範圍）
  const monthsToQuery = semester === 1
    ? [
        { year: baseYear,     month: 8  },
        { year: baseYear,     month: 9  },
        { year: baseYear,     month: 10 },
        { year: baseYear,     month: 11 },
        { year: baseYear,     month: 12 },
        { year: baseYear + 1, month: 1  },
      ]
    : [
        { year: baseYear + 1, month: 2 },
        { year: baseYear + 1, month: 3 },
        { year: baseYear + 1, month: 4 },
        { year: baseYear + 1, month: 5 },
        { year: baseYear + 1, month: 6 },
      ];

  const examDateNameMap = new Map(); // date → clean name

  // 每月一次請求，解析 li 事件清單
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/g;
  const dateSpanRegex = /class="blueWord1 eCLdateFS">([^<]+)<\/span>/;
  const catRegex = /class="eSpec\w+ W14">([^<]+)<\/span>/;
  const nameRegex = /class="GrayWord1 W14"[^>]*>([\s\S]*?)<\/span>/;
  const tagRegex = /<[^>]+>/g;
  // MM/DD 或 MM/DD~(MM/)DD，也支援 YYYY/MM/DD 全年格式
  const rangeRegex = /^(?:\d{4}\/)?(\d{2})\/(\d{2})(?:~(?:(\d{2})\/)?(\d{2}))?/;

  for (const { year, month } of monthsToQuery) {
    const mm = String(month).padStart(2, '0');
    const qDate = `M@${year}-${mm}`;
    let html;
    try {
      html = await fetchBig5(`${BASE}eCalendar_list.php?F_sPeriod=${period}&qDate=${qDate}&qDG=&qSpec=`);
    } catch {
      debugServer('school calendar fetch failed for %s', qDate);
      continue;
    }

    liRegex.lastIndex = 0;
    let liMatch;
    while ((liMatch = liRegex.exec(html)) !== null) {
      const item = liMatch[1];

      // 只看「重要考試」類別
      const catMatch = catRegex.exec(item);
      catRegex.lastIndex = 0;
      if (!catMatch || !catMatch[1].includes('重要考試')) continue;

      // 篩選高中部／高級部
      const nameMatch = nameRegex.exec(item);
      nameRegex.lastIndex = 0;
      if (!nameMatch) continue;
      const name = nameMatch[1].replace(tagRegex, '').trim();
      tagRegex.lastIndex = 0;
      if (!isHighSchoolExam(name)) continue;
      if (!isRelevantExamType(name)) continue;

      // 解析日期範圍
      const dateMatch = dateSpanRegex.exec(item);
      dateSpanRegex.lastIndex = 0;
      if (!dateMatch) continue;
      const rangeMatch = dateMatch[1].trim().match(rangeRegex);
      if (!rangeMatch) continue;

      const [, startM, startD, endM, endD] = rangeMatch;
      const startYear = getYearForMonth(parseInt(startM), period);
      const startDate = `${startYear}${startM}${startD}`;

      const actualEndM = endM || startM;
      const endYear = endD ? getYearForMonth(parseInt(actualEndM), period) : startYear;
      const endDate = endD ? `${endYear}${actualEndM}${endD}` : startDate;

      // 展開範圍內每一天
      const cleanName = getCleanExamName(name);
      let cur = startDate;
      while (cur <= endDate) {
        if (!examDateNameMap.has(cur)) examDateNameMap.set(cur, cleanName);
        cur = advanceDate(cur);
      }
    }
  }

  // 將離散日期合併成連續範圍 event 陣列
  const sortedDates = [...examDateNameMap.keys()].sort();
  const events = [];
  let rangeStart = null;
  let rangeEnd = null;

  for (const dateStr of sortedDates) {
    if (!rangeStart) {
      rangeStart = rangeEnd = dateStr;
    } else if (dateStr === advanceDate(rangeEnd)) {
      rangeEnd = dateStr;
    } else {
      events.push({ startDate: rangeStart, endDate: rangeEnd, name: examDateNameMap.get(rangeStart) || '定期評量', type: 'exam' });
      rangeStart = rangeEnd = dateStr;
    }
  }
  if (rangeStart) {
    events.push({ startDate: rangeStart, endDate: rangeEnd, name: examDateNameMap.get(rangeStart) || '定期評量', type: 'exam' });
  }

  // 同名考試依序編號（如兩個「期中考」→「第一次期中考」「第二次期中考」）
  const ORDINALS = ['一', '二', '三', '四', '五'];
  const nameCount = {};
  for (const ev of events) nameCount[ev.name] = (nameCount[ev.name] || 0) + 1;
  const nameSeq = {};
  for (const ev of events) {
    if (nameCount[ev.name] > 1) {
      nameSeq[ev.name] = (nameSeq[ev.name] || 0) + 1;
      ev.name = `第${ORDINALS[nameSeq[ev.name] - 1] || nameSeq[ev.name]}次${ev.name}`;
    }
  }

  debugServer('school events fetched: %d events, %d exam days', events.length, examDateNameMap.size);

  const fetchedAt = Date.now();
  schoolEventsCache = { data: events, fetchedAt };

  // 存入 MongoDB 持久快取
  if (getIsDbConnected()) {
    try {
      await getSchoolEventsCollection().replaceOne(
        { _id: period },
        { _id: period, events, fetchedAt },
        { upsert: true }
      );
      debugServer('school events saved to MongoDB (period: %s)', period);
    } catch (e) {
      debugServer('MongoDB school events cache write failed: %s', e.message);
    }
  }

  return { cached: false, data: events };
};

module.exports = { getSchoolEvents };
