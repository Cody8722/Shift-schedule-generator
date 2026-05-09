// @ts-check
const { test, expect } = require('@playwright/test');

const BACKEND_URL = 'http://localhost:3000';

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

/**
 * 共用：產生一份最小班表後等待輸出出現。
 */
async function generateMinimalSchedule(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await resetProfileSettings(page);
  await page.reload();
  await page.waitForFunction(
    () => document.getElementById('profile-select')?.options.length > 0,
    { timeout: 10_000 }
  );

  await page.locator('#new-task-name').fill('早班');
  await page.locator('#new-task-count').fill('1');
  await page.locator('#add-task-btn').click();
  await expect(page.locator('#task-list .remove-task')).toHaveCount(1, { timeout: 5_000 });

  await page.locator('#new-personnel-name').fill('張三');
  await page.locator('#add-personnel-btn').click();
  await page.locator('#new-personnel-name').fill('李四');
  await page.locator('#add-personnel-btn').click();
  await expect(page.locator('#personnel-list .remove-personnel')).toHaveCount(2, { timeout: 5_000 });

  await page.locator('#num-weeks').fill('1');
  await page.locator('#generate-schedule').click();
  await expect(page.locator('#output-container')).toBeVisible({ timeout: 15_000 });
}

test.describe('編輯模式', () => {
  test('產生班表後自動進入編輯模式，工具列出現', async ({ page }) => {
    await generateMinimalSchedule(page);
    await expect(page.locator('#edit-toolbar')).toBeVisible();
  });

  test('復原按鈕預設為 disabled', async ({ page }) => {
    await generateMinimalSchedule(page);
    await expect(page.locator('#undo-edit-btn')).toBeDisabled();
  });

  test('重做按鈕預設為 disabled', async ({ page }) => {
    await generateMinimalSchedule(page);
    await expect(page.locator('#redo-edit-btn')).toBeDisabled();
  });

  test('儲存修改按鈕預設為 disabled（尚未修改）', async ({ page }) => {
    await generateMinimalSchedule(page);
    await expect(page.locator('#save-edits-btn')).toBeDisabled();
  });

  test('點擊「預覽模式」後工具列消失', async ({ page }) => {
    await generateMinimalSchedule(page);
    await page.locator('#exit-edit-mode-btn').click();
    await expect(page.locator('#edit-toolbar')).toBeHidden();
  });

  test('人員側邊欄包含已設定的人員名稱', async ({ page }) => {
    await generateMinimalSchedule(page);
    const sidebar = page.locator('#edit-personnel-sidebar');
    await expect(sidebar).toContainText('張三');
    await expect(sidebar).toContainText('李四');
  });

  test('點擊班表格子顯示人員下拉選單', async ({ page }) => {
    await generateMinimalSchedule(page);
    // editable-cell 是班表中可點擊的格子
    // 點左上角避開格子中央的 person-tag（handler 檢查 !e.target.closest('.person-tag')）
    const firstCell = page.locator('.editable-cell').first();
    await firstCell.scrollIntoViewIfNeeded();
    await firstCell.click({ position: { x: 5, y: 5 } });
    // 下拉選單出現
    await expect(page.locator('.personnel-dropdown')).toBeVisible({ timeout: 5000 });
  });

  test('人員視圖 tab 切換後顯示人員表格', async ({ page }) => {
    await generateMinimalSchedule(page);
    await page.locator('#view-personnel-btn').click();
    await expect(page.locator('#personnel-view')).toBeVisible();
    await expect(page.locator('#schedule-output')).toBeHidden();
    // 切回班表視圖
    await page.locator('#view-schedule-btn').click();
    await expect(page.locator('#schedule-output')).toBeVisible();
    await expect(page.locator('#personnel-view')).toBeHidden();
  });
});
