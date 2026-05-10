// @ts-check
const { request } = require('@playwright/test');

const BACKEND_URL = 'http://localhost:3000';
const E2E_PROFILE = 'e2e_test';

module.exports = async () => {
  const ctx = await request.newContext();
  try {
    const res = await ctx.get(`${BACKEND_URL}/api/profiles`);
    if (!res.ok()) return; // no-DB mode: skip isolation

    const data = await res.json();
    // 記住原本的 active profile，teardown 時還原
    process.env._E2E_ORIGINAL_PROFILE = data?.activeProfile || '';

    // 若 e2e_test 不存在就建立
    if (!data?.profiles?.[E2E_PROFILE]) {
      await ctx.post(`${BACKEND_URL}/api/profiles`, { data: { name: E2E_PROFILE } });
    }

    // 清空 e2e_test 的設定
    await ctx.put(`${BACKEND_URL}/api/profiles/${E2E_PROFILE}`, {
      data: { settings: { tasks: [], personnel: [] } },
    });

    // 切換 active profile 到 e2e_test
    await ctx.put(`${BACKEND_URL}/api/profiles/active`, { data: { name: E2E_PROFILE } });
  } catch {
    // no-DB 或伺服器尚未就緒時跳過，不中斷測試
  } finally {
    await ctx.dispose();
  }
};
