const debug = require('debug');
const { connect, disconnect, ensureConfigDocument } = require('./src/db/connect');
const { seedHolidays, refreshHolidaysFromCDN } = require('./src/services/holidayService');
const app = require('./src/app');
const { PORT, MONGODB_URI } = require('./src/config');

const debugServer = debug('app:server');

const startServer = async () => {
  if (!MONGODB_URI) {
    // 無 DB 模式
    app.listen(PORT, () => {
      debugServer(`伺服器正在 http://localhost:${PORT} 上運行 (資料庫模式已禁用)`);
    });
    return;
  }

  try {
    await connect();
    await ensureConfigDocument();
    await seedHolidays();
    await refreshHolidaysFromCDN();
    setInterval(refreshHolidaysFromCDN, 24 * 60 * 60 * 1000);

    app.listen(PORT, () => {
      debugServer(`伺服器正在 http://localhost:${PORT} 上運行`);
    });
  } catch (err) {
    console.error('無法連線到 MongoDB 或啟動伺服器:', err);

    if (err.code === 8000) {
      console.error('\n MongoDB Atlas 錯誤 (code: 8000)');
      if (err.errmsg && err.errmsg.includes('space quota')) {
        console.error('儲存空間配額已用盡！');
        console.error('錯誤訊息:', err.errmsg);
      } else {
        console.error('可能的原因: 資料庫認證失敗、IP 白名單限制或存取權限不足。');
      }
    } else if (err.name === 'MongoNetworkError') {
      console.error('\n MongoDB 網路連線錯誤 - 請檢查網路連線和 URI 格式。');
    } else if (err.name === 'MongoServerError') {
      console.error('\n MongoDB 伺服器錯誤:', err.message, '代碼:', err.code);
    }

    debugServer('伺服器啟動失敗: %O', err);
    // 降級啟動（無資料庫模式）
    app.listen(PORT, () => {
      debugServer(`伺服器正在 http://localhost:${PORT} 上運行 (資料庫連線失敗)`);
    });
  }
};

// 測試環境下的資料庫初始化函數
const initTestDb = async () => {
  if (process.env.NODE_ENV === 'test' && MONGODB_URI) {
    try {
      await connect();
      await ensureConfigDocument();
      await seedHolidays();
      debug('app:db')('測試環境資料庫已初始化');
    } catch (err) {
      debug('app:db')('測試環境資料庫初始化失敗: %O', err);
    }
  }
};

// 導出 app 和輔助函數供測試使用
module.exports = app;
module.exports.initTestDb = initTestDb;

// 僅在非測試環境下自動啟動伺服器
if (process.env.NODE_ENV !== 'test') {
  startServer();

  process.on('SIGINT', async () => {
    debugServer('收到 SIGINT。正在關閉連線...');
    await disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    debugServer('收到 SIGTERM。正在關閉連線...');
    await disconnect();
    process.exit(0);
  });
}
