import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke suite (audit §6 — production readiness). Runs against the BUILT
 * app (`vite preview` over dist/), with all non-local network aborted inside
 * the tests, so every assertion exercises the real bundle deterministically —
 * no live catalog, no AI backend, no flakes. `npm run build` must run first
 * (CI does; locally `npm run e2e` after a build).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Sandboxed/cloud dev environments preinstall Chromium at a fixed path
        // (PLAYWRIGHT_EXECUTABLE_PATH); CI runs `playwright install chromium`
        // and uses the default resolution when the env var is absent.
        launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
          : {},
      },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
