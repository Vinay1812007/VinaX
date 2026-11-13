import { readFileSync } from 'node:fs';
import { test, expect, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * Festival skins — the admin-published override (`/api/appconfig?key=festival`
 * → `{ mode: 'force', id }`) must skin the app: `<html class="fest-<id>">`,
 * a per-festival accent (`--ember-500`) and the ambient `.fest-sky` backdrop,
 * in both the dark and the light theme. Offline-deterministic: every request
 * that leaves localhost is aborted, every /api answer is mocked.
 */

const FESTIVALS = ['diwali', 'christmas', 'holi'] as const;

async function seed(page: Page, theme: 'dark' | 'light', takeover = true): Promise<void> {
  await page.addInitScript(
    ([t, fp, tk]) => {
      localStorage.setItem(
        'vinax.settings.v1',
        JSON.stringify({ state: { theme: t, accent: 'crimson', pinnedLanguages: ['telugu'], festivalTakeover: tk }, version: 2 }),
      );
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    [theme, latestNotesFingerprint(), takeover] as const,
  );
}

/** Abort everything non-local; answer /api with `{}` except the festival key. */
async function mockNetwork(page: Page, forced: { id: string }): Promise<void> {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') {
      return route.fulfill({ json: { festival: { mode: 'force', id: forced.id } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

/** The What's-New sheet is stamped away by `seed`; this is the belt to that brace. */
async function dismissDialogs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((x) =>
      /let.s go/i.test(x.textContent ?? ''),
    );
    b?.click();
  });
}

// The suite dismisses the festival greeting whenever it blocks an action or
// an assertion (e2e/support/test.ts); this spec asserts the greeting itself.
test.use({ dismissFestivalGreeting: false });

for (const theme of ['dark', 'light'] as const) {
  test(`forced festivals skin the ${theme} theme (class, accent, sky)`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const forced = { id: FESTIVALS[0] as string };
    await seed(page, theme);
    await mockNetwork(page, forced);

    const embers: Record<string, string> = {};
    for (const id of FESTIVALS) {
      forced.id = id;
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#main-content');
      await dismissDialogs(page);

      await expect(page.locator('html')).toHaveClass(new RegExp(`\\bfest-${id}\\b`), { timeout: 15_000 });
      // The ambient backdrop mounts a beat after the splash — give it room.
      await expect(page.locator('.fest-sky').first()).toBeAttached({ timeout: 15_000 });
      // 11.0: drawn emblem watermark in the backdrop, and the greeting card is a labelled dialog.
      await expect(page.locator('.fest-sky .fest-wm').first()).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('.fest-card[role="dialog"][aria-labelledby="fest-title"]').first()).toBeAttached({ timeout: 15_000 });

      const info = await page.evaluate(() => ({
        theme: document.documentElement.classList.contains('light') ? 'light' : 'dark',
        ember: getComputedStyle(document.documentElement).getPropertyValue('--ember-500').trim(),
      }));
      expect(info.theme, `theme applied for ${id}`).toBe(theme);
      expect(info.ember, `--ember-500 set for ${id}`).not.toBe('');
      embers[id] = info.ember;
    }

    // Each festival paints its own accent — three festivals, three values.
    expect(new Set(Object.values(embers)).size, `distinct --ember-500 per festival: ${JSON.stringify(embers)}`).toBe(
      FESTIVALS.length,
    );
    expect(pageErrors).toEqual([]);
  });
}

/** The value a generated takeover file sets for a variable (public/fest/<class>.css). */
function takeoverValue(cls: string, theme: 'dark' | 'light', name: string): string {
  const css = readFileSync(new URL(`../public/fest/${cls}.css`, import.meta.url), 'utf8');
  const block = css.split(theme === 'light' ? `html.vx-takeover.${cls}.light {` : `html.vx-takeover.${cls} {`)[1].split('}')[0];
  return new RegExp(`${name}: ([^;]+);`).exec(block)![1].trim();
}

// UI rebuild Phase 6 — the full takeover repaints every surface and text step.
for (const theme of ['dark', 'light'] as const) {
  test(`the full festival takeover repaints the ${theme} theme, and the setting turns it off`, async ({ page }) => {
    await seed(page, theme);
    await mockNetwork(page, { id: 'diwali' });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#main-content');
    const html = page.locator('html');
    await expect(html).toHaveClass(/\bfest-diwali\b/, { timeout: 15_000 });
    await expect(html).toHaveClass(/\bvx-takeover\b/);
    await expect(page.locator('link#vx-fest-css')).toHaveAttribute('href', '/fest/fest-diwali.css');
    const want = takeoverValue('fest-diwali', theme, '--ink-100');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink-100').trim()))
      .toBe(want);
    // The mark wears the day's emblem.
    const ornament = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fest-ornament'));
    expect(ornament).toContain('data:image/svg+xml');
  });
}

test('Full festival look off: the accent and backdrop stay, the takeover does not load', async ({ page }) => {
  await seed(page, 'dark', false);
  await mockNetwork(page, { id: 'diwali' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#main-content');
  await expect(page.locator('html')).toHaveClass(/\bfest-diwali\b/, { timeout: 15_000 });
  await expect(page.locator('html')).not.toHaveClass(/\bvx-takeover\b/);
  await expect(page.locator('link#vx-fest-css')).toHaveCount(0);
});
