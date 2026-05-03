require('dotenv').config();

// 安全的 Profile 名稱格式：字母、數字、中文、底線、連字號，1-50 字符
const SAFE_PROFILE_NAME_REGEX = /^[a-zA-Z0-9_一-龥-]{1,50}$/;
// 安全的班表名稱格式
const SAFE_SCHEDULE_NAME_REGEX = /^[a-zA-Z0-9_一-龥-]{1,100}$/;

const CONFIG_ID = 'main_config';
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'scheduleApp';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

module.exports = {
  SAFE_PROFILE_NAME_REGEX,
  SAFE_SCHEDULE_NAME_REGEX,
  CONFIG_ID,
  PORT,
  MONGODB_URI,
  DB_NAME,
  CORS_ORIGIN,
};
