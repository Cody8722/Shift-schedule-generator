// 刪除不需要的資料庫腳本
// ⚠️ 警告: 此腳本會永久刪除資料庫！請謹慎使用！

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

// 要刪除的資料庫列表 (請根據需要修改)
const DATABASES_TO_DROP = [
    'compressor_db',
    'panorama_db'
    // 如果還有其他不需要的資料庫，請加在這裡
];

// 要保留的資料庫 (安全清單)
const KEEP_DATABASES = [
    'admin',
    'local',
    'config',
    'scheduleApp'  // 您的排班應用程式
];

async function dropUnusedDatabases() {
    if (!MONGODB_URI) {
        console.error('❌ 錯誤: 未提供 MONGODB_URI 環境變數');
        process.exit(1);
    }

    const client = new MongoClient(MONGODB_URI);

    try {
        console.log('🔌 正在連線至 MongoDB Atlas...\n');
        await client.connect();

        const admin = client.db().admin();
        const { databases } = await admin.listDatabases();

        console.log('📊 當前資料庫列表:');
        console.log('═══════════════════════════════════════\n');

        let totalSize = 0;
        for (const dbInfo of databases) {
            const sizeMB = (dbInfo.sizeOnDisk / 1024 / 1024).toFixed(2);
            totalSize += dbInfo.sizeOnDisk;

            const willDrop = DATABASES_TO_DROP.includes(dbInfo.name);
            const isProtected = KEEP_DATABASES.includes(dbInfo.name);

            let status = '✅ 保留';
            if (willDrop) status = '🗑️  將刪除';
            if (isProtected) status = '🔒 系統/受保護';

            console.log(`  ${status} - ${dbInfo.name} (${sizeMB} MB)`);
        }

        console.log('\n═══════════════════════════════════════');
        console.log(`目前總使用量: ${(totalSize / 1024 / 1024).toFixed(2)} MB\n`);

        // 詢問確認
        console.log('⚠️  即將刪除以下資料庫:');
        let sizeToFree = 0;
        for (const dbName of DATABASES_TO_DROP) {
            const dbInfo = databases.find(db => db.name === dbName);
            if (dbInfo) {
                const sizeMB = (dbInfo.sizeOnDisk / 1024 / 1024).toFixed(2);
                sizeToFree += dbInfo.sizeOnDisk;
                console.log(`   - ${dbName} (${sizeMB} MB)`);
            }
        }

        console.log(`\n預計釋放空間: ${(sizeToFree / 1024 / 1024).toFixed(2)} MB\n`);

        // 執行刪除
        console.log('🗑️  開始刪除資料庫...\n');

        for (const dbName of DATABASES_TO_DROP) {
            // 確保不會誤刪系統資料庫
            if (KEEP_DATABASES.includes(dbName)) {
                console.log(`⛔ 跳過受保護的資料庫: ${dbName}`);
                continue;
            }

            try {
                console.log(`正在刪除: ${dbName}...`);
                await client.db(dbName).dropDatabase();
                console.log(`✅ ${dbName} 已刪除\n`);
            } catch (err) {
                console.error(`❌ 刪除 ${dbName} 失敗:`, err.message, '\n');
            }
        }

        // 檢查刪除後的大小
        console.log('📊 刪除後的資料庫狀態:');
        console.log('═══════════════════════════════════════\n');

        const { databases: newDatabases } = await admin.listDatabases();
        let newTotalSize = 0;

        for (const dbInfo of newDatabases) {
            const sizeMB = (dbInfo.sizeOnDisk / 1024 / 1024).toFixed(2);
            newTotalSize += dbInfo.sizeOnDisk;
            console.log(`  📁 ${dbInfo.name}: ${sizeMB} MB`);
        }

        console.log('\n═══════════════════════════════════════');
        console.log(`新總使用量: ${(newTotalSize / 1024 / 1024).toFixed(2)} MB`);
        const freed = ((totalSize - newTotalSize) / 1024 / 1024).toFixed(2);
        console.log(`✅ 已成功釋放: ${freed} MB\n`);

        if (newTotalSize < 400 * 1024 * 1024) {
            console.log('🎉 太好了！您的資料庫現在應該可以正常運作了！');
        } else {
            console.log('⚠️  警告: 仍然使用較多空間，可能需要進一步清理');
        }

    } catch (err) {
        console.error('\n❌ 發生錯誤:', err.message);
        console.error('詳細資訊:', err);
    } finally {
        await client.close();
        console.log('\n🔌 已關閉資料庫連線');
    }
}

// 執行刪除
console.log('⚠️⚠️⚠️  警告 ⚠️⚠️⚠️');
console.log('此腳本將永久刪除資料庫！');
console.log('如果您不確定，請按 Ctrl+C 取消\n');

// 等待 3 秒後執行
setTimeout(() => {
    dropUnusedDatabases().catch(console.error);
}, 3000);
