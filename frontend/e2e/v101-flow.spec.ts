import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 10.1 — Flow, the swipeable feed of song previews, in a real browser with
 * real (silent, seekable) audio:
 *   - the card on screen plays, from its hook point (30% in without lyrics);
 *   - ArrowDown moves to the next card, and that one plays;
 *   - a double tap likes the song;
 *   - leaving Flow puts the listener's own queue back, paused.
 */
const SECONDS = 200;
function silentWav(): Buffer {
  const samples = 8000 * SECONDS;
  const b = Buffer.alloc(44 + samples);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36);
  b.writeUInt32LE(samples, 40); b.fill(128, 44);
  return b;
}
const WAV = silentWav();

const appSong = (base: string, id: string, title: string) => ({
  kind: 'song', id, title, subtitle: 'Queue Artist', artists: [{ id: 'qa', name: 'Queue Artist' }], album: { id: 'qal', name: 'Queue Album' },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/t-${id}.wav` }],
  duration: SECONDS, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: 1,
});
const apiSong = (base: string, i: number) => ({
  id: `f${i}`, name: `Flow Song ${i}`, type: 'song', year: '2025', language: 'telugu', playCount: 100 + i, duration: SECONDS, explicitContent: false, hasLyrics: false,
  album: { id: `al${i}`, name: `Album ${i}`, url: '' },
  artists: { primary: [{ id: `ar${i}`, name: `Singer ${i}`, role: 'singer', image: [], type: 'artist', url: '' }] },
  image: [{ quality: '500x500', url: `${base}/icons/icon.svg` }],
  downloadUrl: [{ quality: '160kbps', url: `${base}/t-f${i}.wav` }],
});

const audioState = (p: Page) =>
  p.evaluate(() => {
    const a = (window as unknown as { __audio?: HTMLMediaElement }).__audio;
    return a ? { src: a.currentSrc || a.src, t: a.currentTime, paused: a.paused } : null;
  });

test('Flow previews the card on screen, moves on, likes on a double tap and gives the queue back', async ({ browser, baseURL }) => {
  const base = baseURL!;
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const queue = [appSong(base, 'q1', 'My Queue One'), appSong(base, 'q2', 'My Queue Two')];
  await page.addInitScript(
    ({ queue, fp }) => {
      if (sessionStorage.getItem('flow-e2e-seeded')) return;
      sessionStorage.setItem('flow-e2e-seeded', '1');
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Asha'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('asha'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', festivalSkins: false, pinnedLanguages: ['telugu'] }, version: 3 }));
      localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue, index: 0 }, version: 1 }));
      // Keep a handle on the engine's <audio> (it is never in the DOM).
      const w = window as unknown as { __audio?: HTMLMediaElement };
      const orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        w.__audio = this;
        return orig.call(this);
      };
    },
    { queue, fp: latestNotesFingerprint() },
  );
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (/^\/t-.*\.wav$/.test(url.pathname)) {
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] ?? '');
      if (!m) return route.fulfill({ body: WAV, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes' } });
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), WAV.length - 1) : WAV.length - 1;
      return route.fulfill({
        status: 206,
        body: WAV.subarray(start, end + 1),
        contentType: 'audio/wav',
        headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${WAV.length}` },
      });
    }
    const cat = Array.from({ length: 10 }, (_, i) => apiSong(base, i));
    if (url.pathname.startsWith('/api/cat/search/songs')) return route.fulfill({ json: { data: { results: cat } } });
    if (url.pathname.startsWith('/api/cat/songs')) return route.fulfill({ json: { data: cat.slice(0, 4) } });
    if (url.pathname.startsWith('/api/cat/search')) {
      return route.fulfill({ json: { data: { songs: { results: cat }, albums: { results: [] }, artists: { results: [] }, playlists: { results: [] } } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });

  // In through the entry card on Home (a real tap, as a listener would).
  await page.goto('/');
  const entry = page.locator('a[href="/flow"]').filter({ hasText: 'Swipe through' }).first();
  await entry.scrollIntoViewIfNeeded();
  await entry.click();
  await expect(page.locator('.vx-flow-card').first()).toBeVisible();
  await expect(page.locator('.vx-flow-hint')).toBeVisible();

  // The first card plays, from its hook (30% of 200 s without lyrics).
  await expect.poll(async () => (await audioState(page))?.paused, { timeout: 15_000 }).toBe(false);
  const first = (await audioState(page))!;
  expect(first.src).toMatch(/\/t-f\d+\.wav$/);
  await expect.poll(async () => (await audioState(page))?.t ?? 0, { timeout: 10_000 }).toBeGreaterThan(55);
  await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible();

  // ArrowDown: the next card settles and plays its own song.
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await audioState(page))?.src ?? '', { timeout: 15_000 }).not.toBe(first.src);
  await expect.poll(async () => (await audioState(page))?.paused, { timeout: 15_000 }).toBe(false);
  const second = (await audioState(page))!;
  expect(second.src).toMatch(/\/t-f\d+\.wav$/);

  // A double tap on the card likes the song.
  const card = page.locator('.vx-flow-card').nth(1);
  const box = (await card.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.3);
  await expect(card.locator('.vx-flow-rail button[aria-pressed]').first()).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => page.evaluate(() => (JSON.parse(localStorage.getItem('vinax.library.v1') ?? '{}')?.state?.favorites ?? []).length)).toBe(1);

  // The ~30 s preview window closes (60 s → 90 s) and the feed moves on by itself.
  await page.evaluate(() => {
    const a = (window as unknown as { __audio?: HTMLMediaElement }).__audio;
    if (a) a.currentTime = 89;
  });
  await expect.poll(async () => (await audioState(page))?.src ?? '', { timeout: 15_000 }).not.toBe(second.src);
  await expect.poll(async () => (await audioState(page))?.paused, { timeout: 15_000 }).toBe(false);

  // While previewing, a reload would still find the listener's own queue.
  await expect
    .poll(async () => page.evaluate(() => (JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}')?.state?.queue ?? []).map((s: { id: string }) => s.id)))
    .toEqual(['q1', 'q2']);

  // Leaving Flow: the queue that was there comes back, paused.
  await page.getByRole('button', { name: 'Close Flow' }).click();
  await expect(page.locator('.vx-flow')).toHaveCount(0);
  await expect.poll(async () => (await audioState(page))?.src ?? '', { timeout: 10_000 }).toContain('/t-q1.wav');
  expect((await audioState(page))?.paused).toBe(true);
  await expect.poll(async () => page.evaluate(() => (JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}')?.state?.queue ?? []).map((s: { id: string }) => s.id))).toEqual(['q1', 'q2']);

  await ctx.close();
});
