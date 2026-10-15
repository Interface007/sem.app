import { defineConfig, devices } from '@playwright/test';

/*
 * E2E_BASE_URL set: test against a running server (CI: the container).
 * Unset: start the locally built server with the web export
 * (requires `pnpm build` first).
 */
const externalBaseUrl = process.env.E2E_BASE_URL;
const port = 4173;

export default defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: externalBaseUrl ?? `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: 'node ../../apps/server/dist/main.js',
          url: `http://127.0.0.1:${port}/health`,
          reuseExistingServer: false,
          env: {
            HOST: '127.0.0.1',
            PORT: String(port),
            WEB_ROOT: '../../apps/mobile/dist',
            APP_VERSION: '0.0.0-e2e',
            GIT_COMMIT: 'e2e',
            LOG_LEVEL: 'warn',
          },
        },
      }),
});
