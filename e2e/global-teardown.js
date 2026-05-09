// @ts-check
const { request } = require('@playwright/test');

const BACKEND_URL = 'http://localhost:3000';
const E2E_PROFILE = 'e2e_test';

module.exports = async () => {
  const ctx = await request.newContext();
  try {
    const original = process.env._E2E_ORIGINAL_PROFILE;
    if (original) {
      await ctx.put(`${BACKEND_URL}/api/profiles/active`, { data: { name: original } });
    }
    await ctx.delete(`${BACKEND_URL}/api/profiles/${encodeURIComponent(E2E_PROFILE)}`);
  } catch {
    // best-effort，不讓 teardown 失敗影響測試結果
  } finally {
    await ctx.dispose();
  }
};
