import { defineConfig } from '@playwright/test'

const port = process.env.SCENEBOARD_TEST_PORT ?? '5188'
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  use: { baseURL, viewport: { width: 1280, height: 900 }, headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'chrome' : undefined) },
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: baseURL, reuseExistingServer: false },
})
