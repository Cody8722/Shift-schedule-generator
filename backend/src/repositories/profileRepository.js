const debug = require('debug');
const { getConfigCollection } = require('../db/connect');
const { CONFIG_ID } = require('../config');

const debugDb = debug('app:db');

const getConfig = async () => {
  const configCollection = getConfigCollection();
  return configCollection.findOne({ _id: CONFIG_ID });
};

const setActiveProfile = async (name) => {
  const configCollection = getConfigCollection();
  const result = await configCollection.updateOne(
    { _id: CONFIG_ID },
    { $set: { activeProfile: name } }
  );
  if (result.modifiedCount === 0) {
    throw new Error('找不到設定檔或無需更新');
  }
};

const createProfile = async (name) => {
  const configCollection = getConfigCollection();
  const update = {
    $set: {
      [`profiles.${name}`]: { settings: { tasks: [], personnel: [] }, schedules: {} },
    },
  };
  const result = await configCollection.updateOne(
    { _id: CONFIG_ID, [`profiles.${name}`]: { $exists: false } },
    update
  );
  if (result.modifiedCount === 0) {
    throw new Error('設定檔已存在');
  }
};

const updateProfileSettings = async (name, settings) => {
  const configCollection = getConfigCollection();
  const config = await configCollection.findOne({ _id: CONFIG_ID });
  if (!config || !config.profiles || !config.profiles[name]) {
    debugDb(`設定檔 "${name}" 不存在`);
    const err = new Error(`找不到設定檔: ${name}`);
    err.status = 404;
    throw err;
  }
  const result = await configCollection.updateOne(
    { _id: CONFIG_ID },
    { $set: { [`profiles.${name}.settings`]: settings } }
  );
  if (result.modifiedCount === 0) {
    debugDb(`設定檔 "${name}" 無需更新（資料相同）`);
  } else {
    debugDb(`設定檔 "${name}" 已成功更新`);
  }
};

const renameProfile = async (oldName, newName, currentActive) => {
  const configCollection = getConfigCollection();
  const config = await configCollection.findOne({ _id: CONFIG_ID });
  if (!config.profiles[oldName] || config.profiles[newName]) {
    throw new Error('無效的名稱或新名稱已存在');
  }
  let update = { $rename: { [`profiles.${oldName}`]: `profiles.${newName}` } };
  if (config.activeProfile === oldName) {
    update.$set = { activeProfile: newName };
  }
  await configCollection.updateOne({ _id: CONFIG_ID }, update);
  debugDb(`設定檔已重新命名: "${oldName}" → "${newName}"`);
};

const deleteProfile = async (name) => {
  const configCollection = getConfigCollection();
  const config = await configCollection.findOne({ _id: CONFIG_ID });
  const profileKeys = Object.keys(config.profiles);
  if (profileKeys.length <= 1) {
    const err = new Error('無法刪除最後一個設定檔');
    err.status = 400;
    throw err;
  }
  let update = { $unset: { [`profiles.${name}`]: '' } };
  if (config.activeProfile === name) {
    const newActiveProfile = profileKeys.find((key) => key !== name);
    update.$set = { activeProfile: newActiveProfile };
  }
  await configCollection.updateOne({ _id: CONFIG_ID }, update);
  debugDb(`設定檔已刪除: "${name}"`);
};

const saveSchedule = async (profileName, scheduleName, data) => {
  const configCollection = getConfigCollection();
  const result = await configCollection.updateOne(
    { _id: CONFIG_ID },
    { $set: { [`profiles.${profileName}.schedules.${scheduleName}`]: data } }
  );
  if (result.modifiedCount === 0) {
    throw new Error('儲存班表失敗');
  }
};

const getSchedule = async (profileName, scheduleName) => {
  const configCollection = getConfigCollection();
  const config = await configCollection.findOne({ _id: CONFIG_ID });
  return config.profiles[profileName]?.schedules?.[scheduleName] || null;
};

const deleteSchedule = async (profileName, scheduleName) => {
  const configCollection = getConfigCollection();
  const result = await configCollection.updateOne(
    { _id: CONFIG_ID },
    { $unset: { [`profiles.${profileName}.schedules.${scheduleName}`]: '' } }
  );
  if (result.modifiedCount === 0) {
    throw new Error('刪除班表失敗');
  }
  debugDb(`班表已刪除: "${scheduleName}"`);
};

module.exports = {
  getConfig,
  setActiveProfile,
  createProfile,
  updateProfileSettings,
  renameProfile,
  deleteProfile,
  saveSchedule,
  getSchedule,
  deleteSchedule,
};
