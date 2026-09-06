const { MongoClient, ServerApiVersion } = require('mongodb');
const debug = require('debug');
const { MONGODB_URI, DB_NAME, CONFIG_ID } = require('../config');

const debugDb = debug('app:db');
const debugServer = debug('app:server');

let client;
let db;
let configCollection;
let holidaysCollection;
let schoolEventsCollection;
let scheduleSharesCollection;
let isDbConnected = false;

if (MONGODB_URI) {
  client = new MongoClient(MONGODB_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
    connectTimeoutMS: 30000,
    socketTimeoutMS: 30000,
    retryWrites: true,
    retryReads: true,
    maxPoolSize: 10,
    minPoolSize: 2,
  });
} else {
  debugServer('警告: 未提供 MONGODB_URI 環境變數。資料庫功能將被禁用。');
}

const getIsDbConnected = () => isDbConnected;

const getConfigCollection = () => configCollection;

const getHolidaysCollection = () => holidaysCollection;

const getSchoolEventsCollection = () => schoolEventsCollection;

const getScheduleSharesCollection = () => scheduleSharesCollection;

const connect = async () => {
  if (!client) return;
  debugServer('正在連線至 MongoDB...');
  await client.connect();
  await client.db('admin').command({ ping: 1 });
  debugDb('成功 Ping 到您的部署。您已成功連線至 MongoDB！');
  db = client.db(DB_NAME);
  configCollection = db.collection('profiles');
  holidaysCollection = db.collection('holidays');
  schoolEventsCollection = db.collection('schoolEvents');
  scheduleSharesCollection = db.collection('scheduleShares');
  // TTL index：只會刪除「有 expiresAt 欄位且已過期」的文件，沒有這個欄位的永久
  // 分享連結不受影響。MongoDB 背景清除任務約每 60 秒跑一次，不是精準即時刪除，
  // 所以 GET /api/schedule-shares/:token 仍須自行檢查 expiresAt，不能只靠這個 index。
  await scheduleSharesCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  isDbConnected = true;
};

const disconnect = async () => {
  if (client) {
    await client.close();
    isDbConnected = false;
  }
};

const ensureConfigDocument = async () => {
  if (!configCollection) return;
  debugDb('正在確認主要設定檔...');
  const update = {
    $setOnInsert: {
      _id: CONFIG_ID,
      activeProfile: 'default',
      profiles: {
        'default': {
          settings: { tasks: [], personnel: [] },
          schedules: {},
        },
      },
    },
  };
  const options = { upsert: true };
  const result = await configCollection.updateOne({ _id: CONFIG_ID }, update, options);
  if (result.upsertedCount > 0) {
    debugDb('找不到設定檔，已成功建立新的預設文件。');
  } else {
    debugDb('設定檔已存在，無需變更。');
  }
};

module.exports = {
  getIsDbConnected,
  getConfigCollection,
  getHolidaysCollection,
  getSchoolEventsCollection,
  getScheduleSharesCollection,
  connect,
  disconnect,
  ensureConfigDocument,
};
