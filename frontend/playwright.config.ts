import { defineConfig } from '@playwright/test';

/**
 * Browser end-to-end suite (`npm run e2e`): real Chromium against the BUILT
 * bundle. `webServer` serves dist/ the way the static host does
 * (e2e/support/serve-dist.mjs); every spec aborts all non-localhost network,
 * so a red run means the app broke, not the internet. `npm run build` must
 * run first (CI does).
 *
 * Specs import `test`/`expect` from `e2e/support/test.ts`, which adds the
 * signed-in test account and the festival-greeting dismissal to every context.
 *
 *   npm run e2e            smoke script + the full suite
 *   npm run e2e:ui         interactive UI mode (watch, time-travel, pick tests)
 *   npm run e2e:report     open the last HTML report
 *   npx playwright test e2e/v70.spec.ts --headed --debug
 *   npx playwright show-trace test-results/<test>/trace.zip
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);
const executablePath = process.env.E2E_CHROMIUM_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './e2e',
  // smoke is superseded by scripts/e2e-smoke.mjs; a11y needs @axe-core/playwright
  // (not installed); qa-sweep is an on-demand harness (QA_SWEEP=1, run by path).
  testIgnore: process.env.QA_SWEEP
    ? ['**/smoke.spec.ts', '**/a11y.spec.ts']
    : ['**/smoke.spec.ts', '**/a11y.spec.ts', '**/qa-sweep.spec.ts'],
  // The specs were tuned under a 120 s budget (lazy chunks on a cold CI box).
  timeout: 120_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--no-sandbox'],
          ...(executablePath ? { executablePath } : {}),
        },
      },
    },
  ],
  webServer: {
    command: `node e2e/support/serve-dist.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
