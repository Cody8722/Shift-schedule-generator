const crypto = require('crypto');
const { getScheduleSharesCollection } = require('../db/connect');

// token 本身當 _id：128 bits 隨機值，猜中機率可忽略不計，不需要額外唯一性檢查。
const createShare = async (profile, scheduleName, personFilter) => {
  const token = crypto.randomBytes(16).toString('hex');
  const collection = getScheduleSharesCollection();
  await collection.insertOne({
    _id: token,
    profile,
    scheduleName,
    personFilter: personFilter || null,
    createdAt: new Date(),
  });
  return token;
};

const getShare = async (token) => {
  const collection = getScheduleSharesCollection();
  return collection.findOne({ _id: token });
};

module.exports = { createShare, getShare };
