import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 4173)
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`
const labPort = Number(process.env.E2E_LAB_PORT ?? 4180)
const labURL = `http://127.0.0.1:${labPort}`

/**
 * 无头浏览器烟雾：build 产物 + vite preview，真实导航全部路由，抓 pageerror / console.error。
 * CI 与本地共用：webServer 启动隔离遥测的本机预览。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/ci/preview-e2e-atlas.mjs',
      url: baseURL,
      reuseExistingServer: !process.env.CI && Boolean(process.env.E2E_BASE_URL),
      timeout: 120_000,
    },
    {
      // Atlas intentionally embeds the standalone Lab in loopback preview.
      // Gate the real page (not only /api/health, which does not compile /lab).
      env: { WAVEWORLD_E2E: '1' },
      command: `WAVEWORLD_BIND_HOST=127.0.0.1 WAVEWORLD_LAB_FRAME_ANCESTOR=http://127.0.0.1:${port} PORT=${labPort} npm run dev --prefix apps/lab -- --webpack`,
      url: `${labURL}/lab`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
