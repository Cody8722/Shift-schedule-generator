// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 新增一筆勤務並確認 input value 正確。
 * 勤務名稱渲染為 <input value="...">，不可用 toContainText。
 */
async function addTask(page, name = '早班', count = '1') {
  const before = await page.locator('#task-list .remove-task').count();
  await page.locator('#new-task-name').fill(name);
  await page.locator('#new-task-count').fill(count);
  await page.locator('#add-task-btn').click();
  await expect(page.locator('#task-list .remove-task')).toHaveCount(before + 1);
  await expect(
    page.locator('#task-list input[data-field="name"]').last()
  ).toHaveValue(name);
}

/**
 * 新增一名人員並確認 input value 正確。
 */
async function addPersonnel(page, name) {
  const before = await page.locator('#personnel-list .remove-personnel').count();
  await page.locator('#new-personnel-name').fill(name);
  await page.locator('#add-personnel-btn').click();
  await expect(page.locator('#personnel-list .remove-personnel')).toHaveCount(before + 1);
  await expect(
    page.locator('#personnel-list input[data-field="name"]').last()
  ).toHaveValue(name);
}

test.describe('產生班表', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('新增勤務後 input value 正確', async ({ page }) => {
    await addTask(page, '夜班', '2');
    // last task input should have the new name
    await expect(
      page.locator('#task-list input[data-field="name"]').last()
    ).toHaveValue('夜班');
  });

  test('新增人員後 input value 正確', async ({ page }) => {
    await addPersonnel(page, '王小明');
    await expect(
      page.locator('#personnel-list input[data-field="name"]').last()
    ).toHaveValue('王小明');
  });

  test('填入最小設定後產生班表，輸出區出現', async ({ page }) => {
    await addTask(page, '早班', '1');
    await addPersonnel(page, '張三');
    await addPersonnel(page, '李四');
    await page.locator('#num-weeks').fill('1');
    await page.locator('#generate-schedule').click();
    await expect(page.locator('#output-container')).toBeVisible({ timeout: 15_000 });
  });

  test('班表輸出包含 table 元素', async ({ page }) => {
    await addTask(page, '早班', '1');
    await addPersonnel(page, '張三');
    await addPersonnel(page, '李四');
    await page.locator('#num-weeks').fill('1');
    await page.locator('#generate-schedule').click();
    await expect(page.locator('#output-container')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#schedule-output table')).toBeVisible();
  });

  test('產生後填補統計面板出現', async ({ page }) => {
    await addTask(page, '早班', '1');
    await addPersonnel(page, '張三');
    await addPersonnel(page, '李四');
    await page.locator('#num-weeks').fill('1');
    await page.locator('#generate-schedule').click();
    await expect(page.locator('#output-container')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#fill-stats-panel')).toBeVisible();
  });

  test('產生多週班表，table 數量等於週數', async ({ page }) => {
    await addTask(page, '早班', '1');
    await addPersonnel(page, '張三');
    await addPersonnel(page, '李四');
    await page.locator('#num-weeks').fill('3');
    await page.locator('#generate-schedule').click();
    await expect(page.locator('#output-container')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#schedule-output table')).toHaveCount(3);
  });

  test('產生後班表視圖/人員視圖切換按鈕出現', async ({ page }) => {
    await addTask(page, '早班', '1');
    await addPersonnel(page, '張三');
    await addPersonnel(page, '李四');
    await page.locator('#num-weeks').fill('1');
    await page.locator('#generate-schedule').click();
    await expect(page.locator('#output-container')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#view-schedule-btn')).toBeVisible();
    await expect(page.locator('#view-personnel-btn')).toBeVisible();
  });

  test('勤務不足（count > 人數）時統計面板仍顯示（ok=false 類）', async ({ page }) => {
    await addTask(page, '早班', '5'); // need 5 per day
    await addPersonnel(page, '張三');   // only 1 person
    await page.locator('#num-weeks').fill('1');
    await page.locator('#generate-schedule').click();
    await expect(page.locator('#output-container')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#fill-stats-panel')).toBeVisible();
  });
});
