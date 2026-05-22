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

async function generateMinimalSchedule(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await resetProfileSettings(page);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#generate-schedule')).toBeVisible();

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
  await expect(page.locator('.editable-cell').first()).toBeVisible({ timeout: 10_000 });
}

/**
 * 點格子左上角並選第一個下拉選項，觸發一次修改。
 */
async function modifyFirstCell(page) {
  const firstCell = page.locator('.editable-cell').first();
  await firstCell.click({ position: { x: 5, y: 5 } });
  const firstOption = page.locator('.personnel-dropdown div.cursor-pointer').first();
  await expect(firstOption).toBeVisible({ timeout: 5_000 });
  await firstOption.click({ force: true });
  await expect(page.locator('#save-edits-btn')).toBeEnabled({ timeout: 3_000 });
}

test.describe('進階編輯', () => {
  test.beforeEach(async ({ page }) => {
    // 清除可能殘留的草稿（需先導航到正確 origin）
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('schedule_draft'));
  });

  test('修改格子後復原，undo 變 disabled、redo 變 enabled', async ({ page }) => {
    await generateMinimalSchedule(page);
    await modifyFirstCell(page);

    await expect(page.locator('#undo-edit-btn')).toBeEnabled();

    await page.locator('#undo-edit-btn').click();

    await expect(page.locator('#undo-edit-btn')).toBeDisabled();
    await expect(page.locator('#redo-edit-btn')).toBeEnabled();
  });

  test('復原後點重做，redo 變 disabled、undo 變 enabled', async ({ page }) => {
    await generateMinimalSchedule(page);
    await modifyFirstCell(page);

    await page.locator('#undo-edit-btn').click();
    await expect(page.locator('#redo-edit-btn')).toBeEnabled({ timeout: 3_000 });

    await page.locator('#redo-edit-btn').click();

    await expect(page.locator('#redo-edit-btn')).toBeDisabled();
    await expect(page.locator('#undo-edit-btn')).toBeEnabled();
    await expect(page.locator('#save-edits-btn')).toBeEnabled();
  });

  test('有修改時點擊差異摘要，顯示 .diff-item', async ({ page }) => {
    await generateMinimalSchedule(page);
    await modifyFirstCell(page);

    await page.locator('#diff-btn').click();
    await expect(page.locator('#diff-modal')).toHaveClass(/open/, { timeout: 3_000 });
    await expect(page.locator('.diff-item')).toBeVisible();
  });

  test('無修改時點擊差異摘要，顯示 .diff-empty', async ({ page }) => {
    await generateMinimalSchedule(page);

    await page.locator('#diff-btn').click();
    await expect(page.locator('#diff-modal')).toHaveClass(/open/, { timeout: 3_000 });
    await expect(page.locator('.diff-empty')).toBeVisible();
  });

  test('修改後等待自動存草稿，重載後顯示草稿橫幅', async ({ page }) => {
    await generateMinimalSchedule(page);
    await modifyFirstCell(page);

    // 等 autoSaveDraft 的 2 秒防抖完成
    await page.waitForTimeout(2_500);

    // 重載後 initApp 會讀 localStorage 並顯示草稿橫幅
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#draft-banner')).toBeVisible({ timeout: 5_000 });
  });

  test('點擊恢復草稿後班表重現，橫幅消失', async ({ page }) => {
    await generateMinimalSchedule(page);
    await modifyFirstCell(page);

    await page.waitForTimeout(2_500);
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#draft-banner')).toBeVisible({ timeout: 5_000 });
    await page.locator('#draft-restore-btn').click();

    await expect(page.locator('#output-container')).toBeVisible();
    await expect(page.locator('#draft-banner')).toBeHidden();
  });

  test('點擊捨棄草稿後橫幅消失', async ({ page }) => {
    await generateMinimalSchedule(page);
    await modifyFirstCell(page);

    await page.waitForTimeout(2_500);
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#draft-banner')).toBeVisible({ timeout: 5_000 });
    await page.locator('#draft-discard-btn').click();

    await expect(page.locator('#draft-banner')).toBeHidden();
  });
});
