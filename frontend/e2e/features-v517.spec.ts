import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * v5.17 listening features, driven from seeded local state (a queue, a
 * library with a collection, twenty days of history, custom accent + display
 * scale + high contrast). Every page must render its new surface from the
 * shipped bundle alone — the catalog and every /api call are dead or `{}`.
 */

test.use({ hasTouch: true });

interface Song {
  kind: 'song';
  id: string;
  title: string;
  subtitle: string;
  artists: { id: string; name: string }[];
  album: { id: string; name: string };
  images: { quality: string; url: string }[];
  audio: { quality: string; url: string }[];
  duration: number;
  language: string;
  year: string;
  explicit: boolean;
  hasLyrics: boolean;
  playCount: number;
}

function makeSongs(base: string): Song[] {
  return Array.from({ length: 14 }, (_, i) => ({
    kind: 'song' as const,
    id: `s${i}`,
    title: `Song ${i}`,
    subtitle: `Artist ${i % 4}`,
    artists: [{ id: `a-s${i}`, name: `Artist ${i % 4}` }],
    album: { id: `al${i % 3}`, name: `Album ${i % 3}` },
    images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }],
    audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
    duration: 200 + i * 7,
    language: 'telugu',
    year: String(1990 + (i % 30)),
    explicit: false,
    hasLyrics: false,
    playCount: 100 - i,
  }));
}

async function seed(page: Page, baseURL: string): Promise<void> {
  const songs = makeSongs(baseURL);
  const now = Date.now();
  const day = 86_400_000;
  const entries: { song: Song; ts: number; completed: boolean }[] = [];
  for (let d = 0; d < 20; d++) {
    for (let k = 0; k < 3; k++) {
      entries.push({ song: songs[(d + k) % songs.length], ts: now - d * day - k * 3_600_000, completed: k < 2 });
    }
  }
  const collection = { id: 'c1', name: 'Road trip', createdAt: now - 5 * day, songs: [songs[0], songs[1], songs[0], songs[2]] };
  await page.addInitScript(
    ({ songs, entries, collection, fp }) => {
      localStorage.setItem(
        'vinax.player.v1',
        JSON.stringify({ state: { queue: songs.slice(0, 3), index: 0, repeat: 'off', shuffle: false, volume: 1, muted: false, rate: 1 }, version: 1 }),
      );
      localStorage.setItem(
        'vinax.settings.v1',
        JSON.stringify({
          state: { theme: 'dark', accent: 'custom', accentCustom: '#ff6a00', uiScale: 'lg', highContrast: true, pinnedLanguages: ['telugu'] },
          version: 2,
        }),
      );
      localStorage.setItem(
        'vinax.library.v1',
        JSON.stringify({ state: { favorites: songs.slice(0, 5), saved: [], collections: [collection], hiddenSongIds: [], later: [], hiddenArtists: [] }, version: 0 }),
      );
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { songs, entries, collection, fp: latestNotesFingerprint() },
  );
}

/** Abort everything non-local; `{}` for every /api call. */
async function mockNetwork(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const bodyText = (page: Page): Promise<string> => page.evaluate(() => document.body.innerText);

async function dismissDialogs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((x) =>
      /let.s go/i.test(x.textContent ?? ''),
    );
    b?.click();
  });
}

async function visit(page: Page, path: string, probe: RegExp): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#main-content');
  await dismissDialogs(page);
  await expect.poll(() => bodyText(page), { timeout: 10_000, message: `${path} shows ${probe}` }).toMatch(probe);
}

/** DOM-level click on the first/last "More options" button (hover-revealed). */
async function openMoreOptions(page: Page, which: 'first' | 'last'): Promise<void> {
  // The shared rail can show the song before the lazy player page mounts.
  await page.waitForSelector('button[aria-label="More options"]', { state: 'attached' });
  const ok = await page.evaluate((w) => {
    const bs = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="More options"]')];
    const b = w === 'first' ? bs[0] : bs[bs.length - 1];
    b?.click();
    return !!b;
  }, which);
  expect(ok, 'a "More options" button exists').toBe(true);
}

async function clickButton(page: Page, pattern: RegExp): Promise<void> {
  const clicked = await page.evaluate(
    ([src, flags]) => {
      const re = new RegExp(src, flags);
      const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => re.test((x.textContent ?? '').trim()));
      b?.click();
      return !!b;
    },
    [pattern.source, pattern.flags],
  );
  expect(clicked, `button matching ${pattern} exists`).toBe(true);
}

test('home, stats, history, explore, library, collection, search, settings render their v5.17 surfaces', async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await seed(page, baseURL);
  await mockNetwork(page);

  await visit(page, '/', /streak[\s\S]*song of the day|because you liked/i);
  // Custom accent, large display scale and high contrast all apply on boot.
  const boot = await page.evaluate(() => ({
    ember: getComputedStyle(document.documentElement).getPropertyValue('--ember-500').trim(),
    fontSize: document.documentElement.style.fontSize,
    hc: document.documentElement.classList.contains('hc'),
  }));
  expect(boot.ember).not.toBe('');
  expect(boot.fontSize).toBe('17.5px');
  expect(boot.hc).toBe(true);

  await visit(page, '/stats', /report[\s\S]*calendar|longest/i);
  await visit(page, '/history', /clear last hour|clear today/i);
  await visit(page, '/explore', /decade radio[\s\S]*pick a year|surprise album/i);
  await visit(page, '/library', /road trip/i);
  await visit(page, '/collection/c1', /duplicate/i);
  await visit(page, '/search', /lyric/i);
  await visit(page, '/settings', /custom accent[\s\S]*display size[\s\S]*high contrast[\s\S]*startup page[\s\S]*data saver/i);
  expect(pageErrors).toEqual([]);
});

test('now-playing "More options" panel: marks, share this moment, ambient mode', async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await seed(page, baseURL);
  await mockNetwork(page);

  await visit(page, '/now-playing', /song 0/i);
  await openMoreOptions(page, 'last');
  await expect.poll(() => bodyText(page)).toMatch(/marks/i);
  const panel = await bodyText(page);
  expect(panel).toMatch(/share this moment/i);
  expect(panel).toMatch(/ambient mode/i);
  expect(pageErrors).toEqual([]);
});

test('song menu: history sheet, and "Not interested" offers an undo toast', async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await seed(page, baseURL);
  await mockNetwork(page);

  await visit(page, '/favorites', /song 0/i);
  await openMoreOptions(page, 'first');
  await expect.poll(() => bodyText(page)).toMatch(/your history with this song/i);
  await clickButton(page, /your history with this song/i);
  const sheet = page.locator('[role="dialog"]').last();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(/plays[\s\S]*finished/i);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await openMoreOptions(page, 'first');
  await expect.poll(() => bodyText(page)).toMatch(/not interested/i);
  await clickButton(page, /^not interested/i);
  await expect.poll(() => bodyText(page)).toMatch(/undo/i);
  expect(pageErrors).toEqual([]);
});
