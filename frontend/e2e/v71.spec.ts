import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * v7.1 from the built bundle, in a real browser:
 *  - "Pin a mood" rebuilds Up Next at once, from songs fetched FOR that mood in
 *    the queue's language (it used to change nothing visible);
 *  - a continuation is five songs, all in the playing song's language;
 *  - Up Next rows read Song – Movie/Album – Artist;
 *  - Home greets by first name, never by a whole device name.
 */
interface ApiSong { kind: 'song'; id: string; title: string; subtitle: string; artists: { primary: { id: string; name: string }[] }; album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[]; duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number }
const song = (base: string, id: string, title: string, artist: string, album: string, language = 'telugu'): ApiSong => ({
  kind: 'song', id, title, subtitle: artist, artists: { primary: [{ id: `a-${artist}`, name: artist }] }, album: { id: `al-${album}`, name: album },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 220, language, year: '2021', explicit: false, hasLyrics: false, playCount: 5000,
});

async function seed(page: Page, baseURL: string): Promise<{ queries: string[] }> {
  const seen = { queries: [] as string[] };
  const usual = Array.from({ length: 10 }, (_, i) => song(baseURL, `u${i}`, `Usual Song ${i}`, `Artist ${i % 5}`, `Film ${i}`));
  const hindi = Array.from({ length: 4 }, (_, i) => song(baseURL, `h${i}`, `Hindi Hit ${i}`, `Singer ${i}`, `Movie ${i}`, 'hindi'));
  const devotional = Array.from({ length: 8 }, (_, i) => song(baseURL, `d${i}`, `Govinda Bhajan ${i}`, `Devotee ${i}`, `Bhakti Album ${i}`));
  const playing = { ...song(baseURL, 'now', 'Samajavaragamana', 'Sid Sriram', 'Ala Vaikunthapurramuloo'), artists: [{ id: 'a-sid', name: 'Sid Sriram' }] };
  await page.addInitScript(({ playing, fp }) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu', 'hindi'], festivalSkins: false, aiDj: false, autoplay: true }, version: 4 }));
    if (!localStorage.getItem('vinax.player.v1')) localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue: [playing], index: 0, repeat: 'off', shuffle: false, volume: 1, muted: false, rate: 1 }, version: 1 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.user-name', JSON.stringify("Vinays'S CG-IT-SA-NA-001 MacBook Air M1"));
    localStorage.setItem('vinax.user-handle', JSON.stringify('vinay'));
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { playing, fp: latestNotesFingerprint() });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/cat/')) {
      const q = (url.searchParams.get('query') ?? '').toLowerCase();
      if (q) seen.queries.push(q);
      if (url.pathname.includes('suggestions')) return route.fulfill({ json: { data: { results: [...usual, ...hindi] } } });
      if (url.pathname.includes('search/songs')) return route.fulfill({ json: { data: { results: q.includes('devotional') ? devotional : [...usual, ...hindi] } } });
      return route.fulfill({ json: { data: { results: [] } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return seen;
}

const queue = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}').state?.queue ?? []) as Array<{ id: string; language: string }>);

test('Pin a mood rebuilds Up Next with songs for that mood, five at a time, in the song’s language', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const seen = await seed(page, baseURL!);
  await page.goto('/now-playing');
  const moods = page.getByRole('group', { name: 'Pin a mood' });
  await expect(moods).toBeVisible();
  await moods.getByRole('button', { name: 'Devotional' }).click();
  await expect(moods.getByRole('button', { name: 'Devotional' })).toHaveAttribute('aria-pressed', 'true');
  // The list is rebuilt NOW — not eight songs from now.
  await expect.poll(() => queue(page).then((q) => q.length), { timeout: 20_000 }).toBeGreaterThan(1);
  const built = await queue(page);
  expect(built[0].id).toBe('now'); // the playing song is untouched
  expect(built.length - 1).toBeLessThanOrEqual(5); // the next five
  expect(built.slice(1).every((s) => s.language === 'telugu')).toBe(true); // never the Hindi hits, though they are pinned and popular
  expect(built.slice(1).filter((s) => s.id.startsWith('d')).length).toBeGreaterThanOrEqual(3); // songs fetched FOR the mood lead the rebuild
  expect(seen.queries.some((q) => q.includes('telugu devotional'))).toBe(true);
  // Rows read Song – Movie/Album – Artist.
  await expect(page.getByText(/Bhakti Album \d – Devotee \d/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/v71-mood-pin-1280.png' });

  // Unpinning goes back to the usual mix — again at once.
  await moods.getByRole('button', { name: 'Devotional' }).click();
  await expect(moods.getByRole('button', { name: 'Devotional' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => queue(page).then((q) => q.slice(1).filter((s) => s.id.startsWith('u')).length), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
});

test('Home greets by first name, not by a device name', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await seed(page, baseURL!);
  await page.goto('/');
  const heading = page.getByRole('heading', { level: 1 }).first();
  await expect(heading).toContainText('Vinay');
  await expect(heading).not.toContainText('CG-IT');
  await expect(heading).not.toContainText('MacBook');
  await page.screenshot({ path: 'test-results/v71-home-greeting-412.png' });
});
