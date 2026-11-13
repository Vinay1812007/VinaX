/**
 * Design system v2, Phase 2 — page changes are View Transitions
 * (utils/pageTransitions.ts, shell.css › page transitions).
 *
 * A spy wraps document.startViewTransition before the app loads, so each
 * test can count how many page changes actually ran inside a transition and
 * whether the browser complained about the named elements.
 */
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const song = (base: string) => ({
  kind: 'song', id: 'vt1', title: 'Transition song', subtitle: 'Artist', artists: [{ id: 'a1', name: 'Artist' }], album: { id: 'al1', name: 'Album' },
  images: [{ quality: '500x500', url: `${base}/icons/icon-512.png` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: 1,
});

async function seed(page: Page, baseURL: string, opts: { reduce?: boolean; track?: boolean } = {}) {
  await page.addInitScript(
    ([fp, q, reduce]) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], reduceMotion: reduce }, version: 3 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
      if (q.length) localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue: q, index: 0, repeat: 'off', shuffle: false, volume: 1, muted: false, rate: 1 }, version: 1 }));
      const w = window as unknown as { __vt: number; __vtErrors: string[] };
      w.__vt = 0;
      w.__vtErrors = [];
      const doc = document as Document & { startViewTransition?: (cb: () => unknown) => unknown };
      const real = doc.startViewTransition?.bind(document);
      if (real) {
        doc.startViewTransition = (cb: () => unknown) => {
          w.__vt += 1;
          const t = real(cb) as { finished: Promise<void> };
          t.finished.catch((e: Error) => w.__vtErrors.push(String(e)));
          return t;
        };
      }
    },
    [latestNotesFingerprint(), opts.track ? [song(baseURL)] : [], !!opts.reduce] as const,
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost') && !url.origin.startsWith('http://127.0.0.1')) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const count = (page: Page) => page.evaluate(() => (window as unknown as { __vt: number }).__vt);

test('a page change runs inside a view transition, and nothing stays named at rest', async ({ page, baseURL }) => {
  await seed(page, baseURL!);
  await page.goto('/library');
  await expect(page.getByRole('heading', { level: 1, name: 'Your library' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('html')).toHaveClass(/\bvx-vt\b/);
  expect(await count(page)).toBe(0); // the first page never transitions (LCP)

  await page.getByRole('navigation', { name: 'Main navigation' }).first().getByRole('link', { name: 'Discover' }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect.poll(() => count(page)).toBe(1);
  // Names exist only while a transition runs: at rest the glass chrome must keep its backdrop.
  await expect(page.locator('html')).not.toHaveClass(/\bvx-vt-on\b/, { timeout: 3000 });
  const atRest = await page.evaluate(() => [...document.body.querySelectorAll('*')].filter((el) => getComputedStyle(el).viewTransitionName !== 'none').length);
  expect(atRest).toBe(0);

  // Back replays it (react-router remembers the transition for the pair).
  await page.goBack();
  await expect(page).toHaveURL(/\/library$/);
  await expect.poll(() => count(page)).toBe(2);
  expect(await page.evaluate(() => (window as unknown as { __vtErrors: string[] }).__vtErrors)).toEqual([]);
});

test('moving inside one screen (a search query) is not a page change', async ({ page, baseURL }) => {
  await seed(page, baseURL!);
  await page.goto('/search');
  const box = page.getByRole('searchbox').or(page.getByRole('combobox')).first();
  await box.fill('kesariya');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/search\/kesariya/);
  expect(await count(page)).toBe(0);
});

test('reduced motion: page changes are instant', async ({ page, baseURL }) => {
  await seed(page, baseURL!, { reduce: true });
  await page.goto('/library');
  await expect(page.getByRole('heading', { level: 1, name: 'Your library' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('navigation', { name: 'Main navigation' }).first().getByRole('link', { name: 'Discover' }).click();
  await expect(page).toHaveURL(/\/discover$/);
  expect(await count(page)).toBe(0);
});

test('the player artwork is one shared element into Now Playing, without duplicate names', async ({ page, baseURL }) => {
  await seed(page, baseURL!, { track: true });
  await page.goto('/library');
  const open = page.locator('button.vx-pb-art');
  await expect(open).toBeVisible({ timeout: 15_000 });
  await open.click();
  await expect(page).toHaveURL(/\/now-playing$/);
  await expect.poll(() => count(page)).toBe(1);
  await expect(page.locator('.vx-np-art')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __vtErrors: string[] }).__vtErrors)).toEqual([]);
});
