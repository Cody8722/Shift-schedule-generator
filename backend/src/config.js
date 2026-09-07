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
// PDF 匯入/匯出隱藏資料加密——Root Key + HKDF 版本衍生機制：
// - PDF_PAYLOAD_SECRET：改版前的舊制單一金鑰，現在只作為 v0（無版號的舊格式）解密相容用，
//   不再用來加密新資料。
// - PDF_PAYLOAD_ROOT_SECRET：唯一需要手動備份的值，永遠不變、不重新產生。
// - PDF_PAYLOAD_KEK_CURRENT：目前加密要用哪一版（例如 "v1"），換版本只改這個值。
//   實際加解密用的金鑰＝HKDF(PDF_PAYLOAD_ROOT_SECRET, info=該版本號) 現場算出來，不另外存。
const PDF_PAYLOAD_SECRET = process.env.PDF_PAYLOAD_SECRET;
const PDF_PAYLOAD_ROOT_SECRET = process.env.PDF_PAYLOAD_ROOT_SECRET;
const PDF_PAYLOAD_KEK_CURRENT = process.env.PDF_PAYLOAD_KEK_CURRENT;

module.exports = {
  SAFE_PROFILE_NAME_REGEX,
  SAFE_SCHEDULE_NAME_REGEX,
  CONFIG_ID,
  PORT,
  MONGODB_URI,
  DB_NAME,
  CORS_ORIGIN,
  PDF_PAYLOAD_SECRET,
  PDF_PAYLOAD_ROOT_SECRET,
  PDF_PAYLOAD_KEK_CURRENT,
};
