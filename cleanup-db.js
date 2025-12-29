// MongoDB 資料庫清理與壓縮腳本
// 用途: 釋放 MongoDB Atlas 中的浪費空間 (索引、碎片等)

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

async function cleanupDatabase() {
    if (!MONGODB_URI) {
        console.error('❌ 錯誤: 未提供 MONGODB_URI 環境變數');
        process.exit(1);
    }

    const client = new MongoClient(MONGODB_URI);

    try {
        console.log('🔌 正在連線至 MongoDB Atlas...\n');
        await client.connect();

        const admin = client.db().admin();

        // 列出所有資料庫
        const { databases } = await admin.listDatabases();

        console.log('📊 資料庫列表:');
        console.log('═══════════════════════════════════════\n');

        let totalSize = 0;
        const userDatabases = databases.filter(db =>
            !['admin', 'local', 'config'].includes(db.name)
        );

        for (const dbInfo of userDatabases) {
            const sizeMB = (dbInfo.sizeOnDisk / 1024 / 1024).toFixed(2);
            totalSize += dbInfo.sizeOnDisk;
            console.log(`  📁 ${dbInfo.name}`);
            console.log(`     大小: ${sizeMB} MB`);
            console.log('');
        }

        console.log('═══════════════════════════════════════');
        console.log(`總使用量: ${(totalSize / 1024 / 1024).toFixed(2)} MB\n`);

        // 壓縮每個資料庫
        console.log('🗜️  開始壓縮資料庫...\n');

        for (const dbInfo of userDatabases) {
            const db = client.db(dbInfo.name);
            console.log(`正在處理: ${dbInfo.name}`);

            try {
                // 獲取所有集合
                const collections = await db.listCollections().toArray();

                for (const collInfo of collections) {
                    const collName = collInfo.name;
                    console.log(`  ⚙️  壓縮集合: ${collName}...`);

                    try {
                        // 執行 compact 命令 (釋放碎片空間)
                        await db.command({ compact: collName, force: true });
                        console.log(`  ✅ ${collName} 壓縮完成`);
                    } catch (err) {
                        // Atlas 可能不支援 compact，嘗試重建索引
                        console.log(`  ⚠️  compact 不支援，嘗試重建索引...`);
                        try {
                            await db.collection(collName).reIndex();
                            console.log(`  ✅ ${collName} 索引重建完成`);
                        } catch (reindexErr) {
                            console.log(`  ⚠️  ${collName} 無法優化: ${reindexErr.message}`);
                        }
                    }
                }

                console.log('');
            } catch (err) {
                console.error(`  ❌ 處理 ${dbInfo.name} 時發生錯誤:`, err.message);
            }
        }

        // 再次檢查大小
        console.log('\n📊 清理後的資料庫大小:');
        console.log('═══════════════════════════════════════\n');

        const { databases: newDatabases } = await admin.listDatabases();
        let newTotalSize = 0;

        for (const dbInfo of newDatabases.filter(db =>
            !['admin', 'local', 'config'].includes(db.name)
        )) {
            const sizeMB = (dbInfo.sizeOnDisk / 1024 / 1024).toFixed(2);
            newTotalSize += dbInfo.sizeOnDisk;
            console.log(`  📁 ${dbInfo.name}: ${sizeMB} MB`);
        }

        console.log('═══════════════════════════════════════');
        console.log(`新總使用量: ${(newTotalSize / 1024 / 1024).toFixed(2)} MB`);
        const saved = ((totalSize - newTotalSize) / 1024 / 1024).toFixed(2);
        console.log(`已釋放空間: ${saved} MB\n`);

        if (saved < 10) {
            console.log('\n⚠️  注意: MongoDB Atlas 壓縮效果有限');
            console.log('建議解決方案:');
            console.log('1. 刪除不需要的資料庫 (compressor_db, panorama_db)');
            console.log('2. 清理舊的假日資料');
            console.log('3. 考慮升級方案或建立新叢集\n');
        }

    } catch (err) {
        console.error('\n❌ 發生錯誤:', err.message);
        console.error('詳細資訊:', err);
    } finally {
        await client.close();
        console.log('🔌 已關閉資料庫連線');
    }
}

// 執行清理
cleanupDatabase().catch(console.error);
