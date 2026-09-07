const { getPdfPayloadKeyStateCollection } = require('../db/connect');

const STATE_ID = 'pdf_payload_key_state';

const getState = async () => {
  const collection = getPdfPayloadKeyStateCollection();
  return collection.findOne({ _id: STATE_ID });
};

// upsert：第一次呼叫（尚無文件）會建立，之後每次輪替都是更新同一筆文件。
const setState = async (currentVersion, rotatedAt) => {
  const collection = getPdfPayloadKeyStateCollection();
  await collection.updateOne(
    { _id: STATE_ID },
    { $set: { currentVersion, rotatedAt } },
    { upsert: true }
  );
};

module.exports = { getState, setState };
