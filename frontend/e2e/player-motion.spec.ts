/**
 * Design system v2, Phase 3 — the player's motion (styles/pages/player.css ›
 * design system v2 motion, components/SongCanvas.tsx). Checks what moves,
 * when it moves, and that nothing moves under reduced motion.
 */
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const song = (base: string, i: number) => ({
  kind: 'song', id: `pm${i}`, title: `Motion song ${i}`, subtitle: `Artist ${i}`, artists: [{ id: `a${i}`, name: `Artist ${i}` }], album: { id: `al${i}`, name: `Album ${i}` },
  images: [{ quality: '500x500', url: `${base}/icons/icon-512.png?${i}` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: 1,
});

async function seed(page: Page, baseURL: string, reduce = false) {
  const queue = [0, 1, 2, 3].map((i) => song(baseURL, i));
  await page.addInitScript(
    ([fp, q, r]) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false, reduceMotion: r }, version: 3 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.analytics-consent', 'true');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
      localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue: q, index: 0, repeat: 'off', shuffle: false, volume: 1, muted: false, rate: 1 }, version: 1 }));
    },
    [latestNotesFingerprint(), queue, reduce] as const,
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost') && !url.origin.startsWith('http://127.0.0.1')) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const anim = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName);

test('Now Playing: the cover eases in on a new song (not on open), panels cross-fade, rows stagger', async ({ page, baseURL }) => {
  await seed(page, baseURL!);
  await page.goto('/now-playing');
  const art = page.locator('.vx-np-art-img');
  await expect(art).toBeVisible({ timeout: 15_000 });
  // Opening Now Playing: the shared-element move covers the cover, so no second animation.
  await expect(art).not.toHaveClass(/\bis-swap\b/);

  await page.getByRole('button', { name: 'Next' }).first().click();
  await expect(page.locator('.vx-np-art-img.is-swap')).toHaveCount(1);
  expect(await anim(page, '.vx-np-art-img')).toBe('vx-art-in');

  expect(await anim(page, '.vx-np-tabpanel')).toBe('vx-np-fade');
  const rows = page.locator('.vx-upnext > li');
  await expect(rows.first()).toBeVisible();
  expect(await rows.first().evaluate((el) => getComputedStyle(el).animationName)).toBe('vx-np-rise');
  // How many rows Up next holds depends on the queue refill timing; the first one always carries its index.
  expect(await rows.first().evaluate((el) => getComputedStyle(el).getPropertyValue('--i').trim())).toBe('0');

  // Play ⇄ pause: the glyph springs in. Polled: while the (blocked) audio
  // buffers, the button swaps its glyph for a spinner and back, so a read can
  // land on a node that was just replaced.
  await expect.poll(() => anim(page, '.vx-np-play > svg')).toBe('vx-glyph-in');
});

test('Queue: rows arrive in a stagger', async ({ page, baseURL }) => {
  await seed(page, baseURL!);
  await page.goto('/queue');
  const row = page.locator('.vx-queue-list > li.vx-queue-row').first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  expect(await row.evaluate((el) => getComputedStyle(el).animationName)).toBe('vx-np-rise');
});

test('reduced motion: none of it moves', async ({ page, baseURL }) => {
  await seed(page, baseURL!, true);
  await page.goto('/now-playing');
  await expect(page.locator('.vx-np-art-img')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Next' }).first().click();
  await expect(page.locator('.vx-np-art-img.is-swap')).toHaveCount(1);
  for (const sel of ['.vx-np-art-img', '.vx-np-tabpanel', '.vx-upnext > li', '.vx-np-play > svg']) {
    expect(await anim(page, sel), sel).toBe('none');
  }
});
