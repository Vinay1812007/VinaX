import { readFileSync } from 'node:fs';
import { test, expect, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 1.14.4 — Flow plays music videos, one per screen, like reels, in a real
 * browser with real (6-second, silent) clips:
 *   - Flow is in the phone tab bar and in the desktop sidebar;
 *   - the reel on screen plays; ArrowDown moves on and the next one plays;
 *   - when a reel ends, the feed moves to the next by itself;
 *   - a double tap likes the reel's song.
 */
const CLIP = readFileSync(new URL('./support/reel.webm', import.meta.url));

const apiSong = (base: string, id: string) => ({
  id, name: `Song ${id}`, type: 'song', year: '2025', language: 'telugu', playCount: 100, duration: 200, explicitContent: false, hasLyrics: false,
  album: { id: `al-${id}`, name: `Album ${id}`, url: '' },
  artists: { primary: [{ id: `ar-${id}`, name: `Singer ${id}`, role: 'singer', image: [], type: 'artist', url: '' }] },
  image: [{ quality: '500x500', url: `${base}/icons/icon.svg` }],
  downloadUrl: [{ quality: '160kbps', url: `${base}/t-${id}.wav` }],
});

let counter = 0;
const apiVideo = (base: string) => {
  const n = counter++;
  return {
    id: `v${n}`, name: `Reel Song ${n} (Lyric Video)`, type: 'video', language: 'Telugu', year: '2025', duration: 6,
    thumbnail: `${base}/icons/icon.svg`, previewUrl: `${base}/reel-v${n}.webm`, streamUrl: `${base}/full-v${n}.webm`,
    songIds: [`song${n}`], artists: { primary: [{ id: `ar${n}`, name: `Singer ${n}` }] },
  };
};

async function setup(page: Page, base: string): Promise<void> {
  await page.addInitScript((fp) => {
    if (sessionStorage.getItem('flow-e2e-seeded')) return;
    sessionStorage.setItem('flow-e2e-seeded', '1');
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.user-name', JSON.stringify('Asha'));
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'] }, version: 3 }));
  }, latestNotesFingerprint());
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost') && !url.origin.startsWith('http://127.0.0.1')) return route.abort();
    if (/^\/full-v\d+\.webm$/.test(url.pathname)) return route.fulfill({ status: 404, body: '' });
    if (/^\/reel-v\d+\.webm$/.test(url.pathname)) {
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] ?? '');
      if (!m) return route.fulfill({ body: CLIP, contentType: 'video/webm', headers: { 'accept-ranges': 'bytes' } });
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), CLIP.length - 1) : CLIP.length - 1;
      return route.fulfill({ status: 206, body: CLIP.subarray(start, end + 1), contentType: 'video/webm', headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${CLIP.length}` } });
    }
    if (url.pathname.startsWith('/api/cat/videos')) return route.fulfill({ json: { data: { results: Array.from({ length: 4 }, () => apiVideo(base)) } } });
    const songId = /^\/api\/cat\/songs\/([^/?]+)$/.exec(url.pathname)?.[1];
    if (songId) return route.fulfill({ json: { data: [apiSong(base, decodeURIComponent(songId))] } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const reelState = (p: Page, i: number) =>
  p.evaluate((i) => {
    const v = document.querySelector<HTMLVideoElement>(`.vx-flow-card[data-flow-index="${i}"] video`);
    return v ? { src: v.currentSrc || v.src, paused: v.paused, t: v.currentTime } : null;
  }, i);

test('Flow is a reels feed of music videos, reached from the phone tab bar', async ({ browser, baseURL }) => {
  const base = baseURL!;
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await setup(page, base);

  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Flow' }).click();
  await expect(page).toHaveURL(/\/flow$/);
  await expect(page.locator('.vx-reel').first()).toBeVisible();
  await expect(page.locator('.vx-flow-hint')).toBeVisible();

  // The first reel plays its preview clip (the full stream 404s, so it is never needed first).
  await expect.poll(async () => (await reelState(page, 0))?.paused, { timeout: 15_000 }).toBe(false);
  expect((await reelState(page, 0))!.src).toMatch(/\/reel-v\d+\.webm$/);

  // ArrowDown: the next reel plays, the first one stops.
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await reelState(page, 1))?.paused, { timeout: 15_000 }).toBe(false);
  await expect.poll(async () => (await reelState(page, 0))?.paused ?? true).toBe(true);

  // A double tap likes the reel's song.
  const card = page.locator('.vx-flow-card[data-flow-index="1"]');
  const box = (await card.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.35);
  await expect.poll(async () => page.evaluate(() => (JSON.parse(localStorage.getItem('vinax.library.v1') ?? '{}')?.state?.favorites ?? []).length), { timeout: 10_000 }).toBe(1);
  await expect(card.getByRole('button', { name: /is in your favorites/ })).toHaveAttribute('aria-pressed', 'true');

  // When the reel ends, the feed moves on by itself.
  await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('.vx-flow-card[data-flow-index="1"] video');
    if (v) v.currentTime = Math.max(0, (v.duration || 6) - 0.2);
  });
  await expect.poll(async () => (await reelState(page, 2))?.paused, { timeout: 15_000 }).toBe(false);

  await page.getByRole('button', { name: 'Close Flow' }).click();
  await expect(page.locator('.vx-flow')).toHaveCount(0);
  await ctx.close();
});

test('Flow is in the desktop sidebar', async ({ browser, baseURL }) => {
  const base = baseURL!;
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await setup(page, base);
  await page.goto('/');
  await page.locator('nav.vx-sidebar-nav').getByRole('link', { name: 'Flow' }).click();
  await expect(page.locator('.vx-reel').first()).toBeVisible();
  await expect.poll(async () => (await reelState(page, 0))?.paused, { timeout: 15_000 }).toBe(false);
  await ctx.close();
});
