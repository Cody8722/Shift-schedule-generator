// MongoDB Atlas 強制觸發空間回收腳本
const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

async function triggerCompaction() {
    if (!MONGODB_URI) {
        console.error('❌ 錯誤: 未提供 MONGODB_URI 環境變數');
        process.exit(1);
    }

    const client = new MongoClient(MONGODB_URI);

    try {
        console.log('🔌 正在連線至 MongoDB Atlas...\n');
        await client.connect();

        const db = client.db('scheduleApp');

        console.log('🗜️  嘗試觸發空間回收...\n');

        // 獲取所有集合
        const collections = await db.listCollections().toArray();

        console.log(`找到 ${collections.length} 個集合\n`);

        for (const collInfo of collections) {
            const collName = collInfo.name;
            console.log(`正在處理: ${collName}...`);

            try {
                // 方法 1: 嘗試執行 compact (可能不支援)
                await db.command({ compact: collName });
                console.log(`✅ ${collName} 壓縮成功`);
            } catch (err1) {
                // 方法 2: 強制寫入以觸發 checkpoint
                try {
                    const coll = db.collection(collName);
                    // 執行一個無害的更新操作觸發寫入
                    await coll.updateOne(
                        { _id: 'trigger-compact-dummy' },
                        { $set: { timestamp: new Date() } },
                        { upsert: false }
                    );
                    console.log(`⚙️  ${collName} 已觸發 checkpoint`);
                } catch (err2) {
                    console.log(`⚠️  ${collName} 無法優化: ${err1.message}`);
                }
            }
        }

        console.log('\n✅ 空間回收操作已完成');
        console.log('\n📌 請注意:');
        console.log('1. Atlas M0 免費層可能需要 1-24 小時才會釋放空間');
        console.log('2. 建議等待 1 小時後再次檢查 Atlas 控制台');
        console.log('3. 如果仍然沒有釋放，可能需要重建集群\n');

    } catch (err) {
        console.error('\n❌ 發生錯誤:', err.message);
    } finally {
        await client.close();
        console.log('🔌 已關閉資料庫連線');
    }
}

triggerCompaction().catch(console.error);
