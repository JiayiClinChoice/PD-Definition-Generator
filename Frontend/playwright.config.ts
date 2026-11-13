import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 768, height: 1024 } } },
    { name: 'landscape', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 812, height: 375 }, reducedMotion: 'reduce' } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
    timeout: 60000,
  },
})
