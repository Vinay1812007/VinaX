import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 8.5.0 AI music features from the built bundle with mocked APIs:
 *  - AI Playlist shows the curator's reason under each pick and never shows
 *    a song the catalogue listed in place of a suggestion it does not have;
 *  - the taste profile shows "How you listen";
 *  - "songs like <a song>" answers with the catalogue's similar songs and
 *    says so, and still works when the deployed backend has no /api/ai/search;
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
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false, aiAssist: true }, version: 3 }));
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

test('AI Playlist shows why each pick fits, and leaves out a suggestion the catalogue does not have', async ({ page, baseURL }) => {
  const base = baseURL!;
  const night = mk(base, 'n1', 'Night Road', 'Singer One');
  const stars = mk(base, 'n2', 'Silver Stars', 'Singer Two');
  const famousOther = mk(base, 'x1', 'A Famous Different Song', 'Someone Else');
  await seedStorage(page);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/playlist') {
      return route.fulfill({ json: { name: 'Late Night Drive', description: 'Atmospheric tracks for a night drive.', songs: [
        { title: 'Night Road', artist: 'Singer One', reason: 'Matches the late-night, atmospheric mood' },
        { title: 'Invented Title', artist: 'Nobody Real', reason: 'Would be perfect' },
        { title: 'Silver Stars', artist: 'Singer Two', reason: 'Slow build under city lights' },
      ] } });
    }
    if (url.pathname.startsWith('/api/cat/')) {
      const q = (url.searchParams.get('query') ?? '').toLowerCase();
      if (q.startsWith('night road')) return route.fulfill({ json: { data: { results: [night] } } });
      if (q.startsWith('silver stars')) return route.fulfill({ json: { data: { results: [stars] } } });
      // The invented suggestion's search lists only a different, popular song.
      if (q.startsWith('invented title')) return route.fulfill({ json: { data: { results: [famousOther] } } });
      return route.fulfill({ json: { data: { results: [] } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {}, status: 404 });
    return route.continue();
  });
  await page.goto('/ai-playlist');
  await page.fill('#playlist-idea', 'Make me a playlist for a late-night drive');
  await page.getByRole('button', { name: /Build my playlist/ }).click();
  await expect.poll(() => bodyText(page), { timeout: 30_000 }).toMatch(/Late Night Drive/);
  const text = await bodyText(page);
  expect(text).toMatch(/Night Road/);
  expect(text).toMatch(/Matches the late-night, atmospheric mood/);
  expect(text).toMatch(/Slow build under city lights/);
  expect(text).not.toMatch(/A Famous Different Song/);
  expect(text).not.toMatch(/Would be perfect/);
  // The app scrolls inside its own container: bring the list into view and capture it.
  await page.locator('.vx-ai-result').scrollIntoViewIfNeeded();
  await page.locator('.vx-ai-result').screenshot({ path: 'test-results/v85-ai-playlist-reasons.png' });
});

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

test('"songs like <a song>" answers with the catalogue\'s similar songs, even when the backend has no AI search yet', async ({ page, baseURL }) => {
  const base = baseURL!;
  const seed = mk(base, 'seed1', 'Night Road', 'Singer One');
  const similar = [mk(base, 'sim1', 'Moon Lane', 'Artist A'), mk(base, 'sim2', 'Quiet Harbour', 'Artist B'), mk(base, 'sim3', 'Night Road', 'Singer One')];
  await seedStorage(page);
  const aiSearchCalls: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    // An older deployed Worker: the route does not exist.
    if (url.pathname === '/api/ai/search') {
      aiSearchCalls.push(route.request().postData() ?? '');
      return route.fulfill({ status: 404, body: 'Not found' });
    }
    if (url.pathname === '/api/cat/songs/seed1/suggestions') return route.fulfill({ json: { data: similar } });
    // The page's own combined search (its results are not what this test is about).
    if (url.pathname === '/api/cat/search') return route.fulfill({ json: { data: { songs: { results: [] }, albums: { results: [] }, artists: { results: [] }, playlists: { results: [] } } } });
    if (url.pathname.startsWith('/api/cat/')) {
      const q = (url.searchParams.get('query') ?? '').toLowerCase();
      if (q === 'night road') return route.fulfill({ json: { data: { results: [seed] } } });
      return route.fulfill({ json: { data: { results: [] } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  await page.goto('/search/' + encodeURIComponent('songs like Night Road'));
  await expect.poll(() => bodyText(page), { timeout: 30_000, message: 'no "songs like" explanation' }).toMatch(/Songs like “Night Road” by Singer One/);
  const section = page.locator('section[aria-label="Songs that match"]');
  await expect(section).toContainText('Moon Lane');
  await expect(section).toContainText('Quiet Harbour');
  // The seed and its other release are not recommended back.
  await expect(section.locator('.vx-track-list')).not.toContainText('Night Road');
  expect(aiSearchCalls.length).toBeGreaterThan(0);
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: 'test-results/v85-songs-like.png' });
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
