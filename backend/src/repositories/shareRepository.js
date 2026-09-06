const crypto = require('crypto');
const { getScheduleSharesCollection } = require('../db/connect');

// token 本身當 _id：128 bits 隨機值，猜中機率可忽略不計，不需要額外唯一性檢查。
// expiresInDays 為 null/undefined 時代表永久有效，不寫入 expiresAt 欄位——
// MongoDB 的 TTL index（見 db/connect.js）只會清掉「有 expiresAt 且已過期」的文件，
// 沒有這個欄位的永久連結完全不受影響。
const createShare = async (profile, scheduleName, personFilter, expiresInDays) => {
  const token = crypto.randomBytes(16).toString('hex');
  const collection = getScheduleSharesCollection();
  const doc = {
    _id: token,
    profile,
    scheduleName,
    personFilter: personFilter || null,
    createdAt: new Date(),
  };
  if (expiresInDays) {
    doc.expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  }
  await collection.insertOne(doc);
  return token;
};

const getShare = async (token) => {
  const collection = getScheduleSharesCollection();
  return collection.findOne({ _id: token });
};

const listShares = async (profile, scheduleName) => {
  const collection = getScheduleSharesCollection();
  return collection.find({ profile, scheduleName }).sort({ createdAt: -1 }).toArray();
};

const deleteShare = async (token) => {
  const collection = getScheduleSharesCollection();
  const result = await collection.deleteOne({ _id: token });
  return result.deletedCount > 0;
};

module.exports = { createShare, getShare, listShares, deleteShare };
