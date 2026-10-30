import { test, expect, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 8.5.0 music features from the built bundle with mocked APIs:
 *  - the taste profile shows "How you listen";
 *  - Home shows Similar artists from the catalogue's artist pages.
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
const mk = (base: string, id: string, title: string, artist: string, year = '2020'): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist.replace(/\s+/g, '-')}`, name: artist }], album: { id: `al-${id}`, name: `Album ${id}` },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200, language: 'telugu', year, explicit: false, hasLyrics: false, playCount: 5,
});

async function seedStorage(page: Page, extra: { favorites?: Song[]; entries?: unknown[]; profile?: unknown } = {}): Promise<void> {
  await page.addInitScript(
    ({ favorites, entries, profile, fp }) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false }, version: 3 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites, saved: [], collections: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] }, version: 0 }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      if (profile) localStorage.setItem('vinax.profile.v1', JSON.stringify(profile));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { favorites: extra.favorites ?? [], entries: extra.entries ?? [], profile: extra.profile ?? null, fp: latestNotesFingerprint() },
  );
}

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);

test('the taste profile shows how you listen', async ({ page, baseURL }) => {
  const base = baseURL!;
  const now = Date.now();
  const songs = Array.from({ length: 6 }, (_, i) => mk(base, `t${i}`, i % 2 ? `Love Song ${i}` : `Dance Song ${i}`, `Artist ${i % 3}`));
  const entries = songs.map((song, i) => ({ song, ts: now - i * 3_600_000, completed: true }));
  const profile = {
    version: 1, createdAt: now - 10 * 86_400_000, updatedAt: now,
    languages: { telugu: { score: 12, plays: 20, completes: 14, skips: 4, lastTs: now } },
    artists: { 'a-Artist-0': { name: 'Artist 0', score: 8, plays: 10, completes: 7, skips: 1, lastTs: now } },
    hourHistogram: Array.from({ length: 24 }, (_, h) => (h === 21 ? 6 : 1)),
    hourBuckets: {}, recentSongIds: [], skippedSongIds: [], likedSongIds: [], dislikedSongIds: ['t9'],
    totals: { plays: 20, completes: 14, skips: 4, favorites: 2, queueAdds: 1, dislikes: 1, playlistAdds: 2 },
  };
  await seedStorage(page, { favorites: songs.slice(0, 2), entries, profile });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  await page.goto('/taste-profile');
  await expect.poll(() => bodyText(page), { timeout: 20_000 }).toMatch(/How you listen/i);
  const text = await bodyText(page);
  expect(text).toMatch(/Skip rate/i);
  expect(text).toMatch(/20%/); // 4 skips over 20 plays
  expect(text).toMatch(/Discovery mode/i);
  expect(text).toMatch(/One song marked Not interested/);
  const heading = page.getByRole('heading', { name: 'How you listen' });
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400); // let the page's entrance fade finish
  await page.screenshot({ path: 'test-results/v85-taste-how-you-listen.png' });
});

test('Home shows Similar artists the listener has not played yet', async ({ page, baseURL }) => {
  const base = baseURL!;
  const now = Date.now();
  const played = ['Artist Zero', 'Artist One', 'Artist Two'].flatMap((name, a) => Array.from({ length: 3 }, (_, i) => mk(base, `h${a}${i}`, `Song ${a}${i}`, name)));
  const entries = played.map((song, i) => ({ song, ts: now - i * 600_000, completed: true }));
  const artistPage = (id: string, name: string, similar: Array<{ id: string; name: string }>) => ({
    data: { id, name, image: [], topSongs: [], topAlbums: [], similarArtists: similar.map((s) => ({ ...s, image: `${base}/icons/icon.svg` })) },
  });
  await seedStorage(page, { entries });
  await page.addInitScript(() => {
    localStorage.setItem('vinax.home.design.v1', JSON.stringify({ title: 'Test', description: 'd', order: ['quick', 'personal'], hidden: ['aihome', 'discovery', 'charts', 'seasonal', 'moods', 'genres', 'artists', 'albums', 'daypicks', 'loved', 'feed'] }));
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    const m = /^\/api\/cat\/artists\/([^/?]+)$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const names: Record<string, string> = { 'a-Artist-Zero': 'Artist Zero', 'a-Artist-One': 'Artist One', 'a-Artist-Two': 'Artist Two' };
      return route.fulfill({ json: artistPage(id, names[id] ?? id, [
        { id: 'new-1', name: 'Fresh Voice' }, { id: 'new-2', name: 'Second Voice' }, { id: 'new-3', name: 'Third Voice' },
        { id: 'a-Artist-One', name: 'Artist One' }, // already played: left out
      ]) });
    }
    if (url.pathname.startsWith('/api/cat/')) return route.fulfill({ json: { data: { results: [] } } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  await page.goto('/');
  await page.waitForSelector('.vx-hero');
  // 8.5.1 — the shelf mounts only near the viewport: step down the page the way a
  // listener does (a jump to the very bottom lands past visibility-mounted blocks).
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          const main = document.querySelector('#main-content');
          if (main) main.scrollBy(0, 500);
          window.scrollBy(0, 500);
        });
        await page.waitForTimeout(250);
        return bodyText(page);
      },
      { timeout: 25_000 },
    )
    .toMatch(/Similar artists/);
  const text = await bodyText(page);
  expect(text).toMatch(/Fresh Voice/);
  expect(text).toMatch(/Like Artist Zero/);
  const shelfTitle = page.getByRole('heading', { name: 'Similar artists' });
  await shelfTitle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/v85-similar-artists.png' });
});
