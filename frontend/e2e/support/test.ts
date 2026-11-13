/**
 * The `test` every spec in e2e/ imports, the stock `@playwright/test` one
 * with VinaX's suite-wide fixtures added:
 *
 *   import { test, expect, type Page } from './support/test';
 *
 * Everything else (viewport, locale, timezone, baseURL, the built-bundle
 * server) lives in `playwright.config.ts`.
 */
import { test as base, type BrowserContext } from '@playwright/test';

export { expect } from '@playwright/test';
export type { Browser, BrowserContext, Locator, Page, Request, Route } from '@playwright/test';

/** Signs the context in on every page. */
async function prepareContext(ctx: BrowserContext): Promise<void> {
  // 13.0: the app needs a Google account, so every context starts signed in
  // with a test account. The session is never checked against a real server.
  // A page opened with ?e2e-signed-out in its address stays signed out.
  await ctx.addInitScript(() => {
    try {
      if (location.search.includes('e2e-signed-out') || localStorage.getItem('vinax.account.v1')) return;
      localStorage.setItem(
        'vinax.account.v1',
        JSON.stringify({
          session: 'vx1.e2e.test',
          user: { name: 'Tester', email: 'tester@example.com', picture: null, username: 'tester' },
        }),
      );
    } catch {
      /* storage blocked: the test sees the sign-in screen */
    }
  });
}

export const test = base.extend({
  // Worker-scoped so contexts a spec opens itself with browser.newContext()
  // (Listen Together runs a host and a guest) get the same treatment as the
  // built-in `context` fixture, which also goes through browser.newContext().
  browser: [
    async ({ browser }, use) => {
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...args: Parameters<typeof browser.newContext>) => {
        const ctx = await newContext(...args);
        await prepareContext(ctx);
        return ctx;
      };
      await use(browser);
    },
    { scope: 'worker' },
  ],
});
