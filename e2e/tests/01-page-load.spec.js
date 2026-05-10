// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('頁面載入', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('頁面標題包含「排班」', async ({ page }) => {
    await expect(page).toHaveTitle(/排班/);
  });

  test('設定面板可見：勤務區塊', async ({ page }) => {
    await expect(page.locator('#add-task-btn')).toBeVisible();
  });

  test('設定面板可見：人員區塊', async ({ page }) => {
    await expect(page.locator('#add-personnel-btn')).toBeVisible();
  });

  test('產生班表按鈕可見', async ({ page }) => {
    await expect(page.locator('#generate-schedule')).toBeVisible();
  });

  test('輸出區預設隱藏', async ({ page }) => {
    await expect(page.locator('#output-container')).toBeHidden();
  });

  test('頁尾顯示版權年份', async ({ page }) => {
    const year = new Date().getFullYear().toString();
    await expect(page.locator('#footer-year')).toHaveText(year);
  });

  test('深色模式切換按鈕可見', async ({ page }) => {
    await expect(page.locator('#theme-toggle')).toBeVisible();
  });

  test('深色模式切換後 html 帶有 dark class', async ({ page }) => {
    await page.locator('#theme-toggle').click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    // 再次切換恢復
    await page.locator('#theme-toggle').click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});
