/**
 * E2E spec runner config (`npm run e2e` → `vitest run --config e2e/vitest.config.ts`).
 *
 * The repo ships `playwright-core` (browser driver) but not the separate
 * `@playwright/test` runner, so the specs in this folder are executed by
 * vitest (already a devDependency) driving real Chromium through
 * playwright-core. `e2e/support/playwright-test.ts` is aliased in as
 * `@playwright/test` — it provides the `test`/`expect`/`page` surface the
 * specs use, so a spec reads exactly like a stock Playwright spec and would
 * run unchanged under `playwright.config.ts` if the real runner were ever
 * installed.
 *
 * The built bundle (`dist/`) is served by `e2e/support/global-setup.ts` on an
 * ephemeral localhost port; every spec aborts all non-localhost network, so a
 * red run means the app broke, not the internet. `npm run build` must run
 * first (CI does).
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('..'),
  resolve: {
    alias: { '@playwright/test': here('./support/playwright-test.ts') },
  },
  test: {
    include: ['e2e/**/*.spec.ts'],
    // These three pre-date the runner: a11y needs @axe-core/playwright (not
    // installed), qa-sweep is an on-demand harness, smoke is superseded by
    // scripts/e2e-smoke.mjs. They stay untouched here.
    exclude: ['**/node_modules/**', 'e2e/smoke.spec.ts', 'e2e/a11y.spec.ts', 'e2e/qa-sweep.spec.ts'],
    globalSetup: ['e2e/support/global-setup.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 120_000,
    hookTimeout: 60_000,
    retry: process.env.CI ? 1 : 0,
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
    passWithNoTests: false,
  },
});
