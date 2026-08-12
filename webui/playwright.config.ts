import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath, URL } from 'node:url'

const appRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'panel-280', use: { ...devices['Desktop Chrome'], viewport: { width: 280, height: 720 } } },
    { name: 'panel-wide', use: { ...devices['Desktop Chrome'], viewport: { width: 960, height: 800 } } }
  ],
  webServer: {
    command: `${JSON.stringify(process.execPath)} ../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173`,
    cwd: appRoot,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI
  }
})
