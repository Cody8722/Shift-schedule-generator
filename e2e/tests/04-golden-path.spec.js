// @ts-check
const { test, expect } = require('@playwright/test');

const BACKEND_URL = 'http://localhost:3000';

/**
 * 透過 API 將 active profile 的 settings 重置為空，
 * 避免跨測試的 MongoDB 狀態污染（tasks/personnel 累積）。
 */
async function resetProfileSettings(page) {
  const res = await page.request.get(`${BACKEND_URL}/api/profiles`);
  const data = await res.json();
  const activeProfile = data?.activeProfile;
  if (!activeProfile) return;

  for (let attempt = 0; attempt < 5; attempt++) {
    await page.request.put(
      `${BACKEND_URL}/api/profiles/${encodeURIComponent(activeProfile)}`,
      { data: { settings: { tasks: [], personnel: [] } } }
    );
    await new Promise((r) => setTimeout(r, 300));
    const check = await page.request.get(`${BACKEND_URL}/api/profiles`);
    const checkData = await check.json();
    const profile = checkData?.profiles?.[activeProfile];
    if (!profile?.settings?.tasks?.length && !profile?.settings?.personnel?.length) return;
  }
}

async function generateMinimalSchedule(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await resetProfileSettings(page);
  await page.reload();
  await expect(page.locator('#generate-schedule')).toBeVisible();

  await page.locator('#new-task-name').fill('早班');
  await page.locator('#new-task-count').fill('1');
  await page.locator('#add-task-btn').click();

  await page.locator('#new-personnel-name').fill('張三');
  await page.locator('#add-personnel-btn').click();
  await page.locator('#new-personnel-name').fill('李四');
  await page.locator('#add-personnel-btn').click();

  await page.locator('#num-weeks').fill('1');
  await page.locator('#generate-schedule').click();

  await expect(page.locator('#output-container')).toBeVisible({ timeout: 15_000 });
  // 等待 editable-cell 穩定（renderEditableSchedule 全部完成）
  await expect(page.locator('.editable-cell').first()).toBeVisible({ timeout: 10_000 });
}

test.describe('黃金路徑', () => {
  test('編輯格子後儲存，edit-status 顯示已儲存、toast 出現', async ({ page }) => {
    await generateMinimalSchedule(page);

    // 點格子左上角（避開中央的 person-tag，handler 有 !e.target.closest('.person-tag') 檢查）
    const firstCell = page.locator('.editable-cell').first();
    await firstCell.click({ position: { x: 5, y: 5 } });

    // 等 dropdown 出現，點第一個可點擊的選項（移除已指派人員）
    const firstOption = page.locator('.personnel-dropdown div.cursor-pointer').first();
    await expect(firstOption).toBeVisible({ timeout: 5_000 });
    // force: true 避免 fixed-position dropdown 落在 viewport 邊緣外時的點擊失敗
    await firstOption.click({ force: true });

    // 修改後 save 按鈕應啟用
    await expect(page.locator('#save-edits-btn')).toBeEnabled();

    // 點儲存
    await page.locator('#save-edits-btn').click();

    // toast 出現且 edit-status 更新
    await expect(page.locator('#toast-container')).toContainText('已儲存', { timeout: 5_000 });
    await expect(page.locator('#edit-status')).toHaveText('已儲存');
  });

  test('儲存後 save 按鈕再次變為 disabled', async ({ page }) => {
    await generateMinimalSchedule(page);

    const firstCell = page.locator('.editable-cell').first();
    await firstCell.click({ position: { x: 5, y: 5 } });

    const firstOption = page.locator('.personnel-dropdown div.cursor-pointer').first();
    await expect(firstOption).toBeVisible({ timeout: 5_000 });
    // force: true 避免 fixed-position dropdown 落在 viewport 邊緣外時的點擊失敗
    await firstOption.click({ force: true });

    // 等 DOM 穩定後再點儲存（option click 後 rAF 回呼尚未結束）
    await expect(page.locator('#save-edits-btn')).toBeEnabled({ timeout: 3_000 });
    await page.locator('#save-edits-btn').click();
    await expect(page.locator('#save-edits-btn')).toBeDisabled();
  });

  test('匯出 Excel 觸發下載，檔名為 班表.xlsx', async ({ page }) => {
    await generateMinimalSchedule(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#export-excel').click(),
    ]);

    expect(download.suggestedFilename()).toBe('班表.xlsx');
  });

  test('匯出 PDF 觸發下載，檔名為 班表.pdf', async ({ page }) => {
    await generateMinimalSchedule(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.locator('#export-pdf').click(),
    ]);

    expect(download.suggestedFilename()).toBe('班表.pdf');
  });
});
