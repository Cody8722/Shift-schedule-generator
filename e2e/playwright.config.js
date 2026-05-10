// @playwright/test 1.59.1
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.js',
  globalTeardown: './global-teardown.js',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      // 後端：無 MONGODB_URI → 以 no-DB 模式啟動，generate-schedule 仍可用
      // reuseExistingServer: false 確保每次 E2E 都用最新程式碼啟動，
      // 避免 rate-limiter 記憶體狀態跨 run 累積。
      // 執行 E2E 前請先停止本機 backend dev server（port 3000）。
      command: 'node server.js',
      cwd: '../backend',
      port: 3000,
      reuseExistingServer: false,
      env: { NODE_ENV: 'e2e' },
      timeout: 30_000,
    },
    {
      // 前端：Vite dev server
      command: 'npm run dev',
      cwd: '../frontend',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
  ],
});
