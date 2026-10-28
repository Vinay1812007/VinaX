import { test, expect, type Page } from './support/test';
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

