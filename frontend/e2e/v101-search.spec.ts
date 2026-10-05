import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 10.1 search, from the built bundle, in a real browser:
 *  - the typeahead opens under the field as the listener types: completions
 *    (the typed part in bold), then song, artist and album hits;
 *  - it is a real combobox: ↑/↓ move the active option, Enter picks it,
 *    Escape closes it;
 *  - the results page leads with a Top result card whose play button plays;
 *  - allotment: when the first catalogue endpoint stalls, an interactive
 *    search is hedged to the next one and answers long before the stall ends.
 *
 * Two catalogue hosts are mocked with route handlers: the primary remote
 * catalogue and the same-origin one. Everything else off localhost is aborted.
 */
interface ApiSong {
  kind: 'song'; id: string; title: string; subtitle: string;
  artists: { primary: Array<{ id: string; name: string }> };
  album: { id: string; name: string };
  image: Array<{ quality: string; url: string }>;
  downloadUrl: Array<{ quality: string; url: string }>;
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}

const TITLES: Array<[string, string, string]> = [
  ['Kesariya', 'Arijit Singh', 'hindi'],
  ['Kesariya Rangu', 'Shreya Ghoshal', 'telugu'],
  ['Kesari Nandan', 'Sukhwinder Singh', 'hindi'],
  ['Kesar Ki Kyari', 'Shankar Mahadevan', 'hindi'],
  ['Kesaria Balam', 'Mame Khan', 'rajasthani'],
  ['Kesariyo Rang', 'Asha Bhosle', 'hindi'],
  ['Samajavaragamana', 'Sid Sriram', 'telugu'],
  ['Butta Bomma', 'Armaan Malik', 'telugu'],
];

const song = (base: string, i: number): ApiSong => {
  const [title, artist, language] = TITLES[i];
  return {
    kind: 'song', id: `s${i}`, title, subtitle: artist,
    artists: { primary: [{ id: `ar${i}`, name: artist }] },
    album: { id: `al${i}`, name: `${title} (Original Soundtrack)` },
    image: [{ quality: '500x500', url: `${base}/icons/icon.svg` }],
    downloadUrl: [{ quality: '160kbps', url: `${base}/e2e-silence.wav` }],
    duration: 230, language, year: '2022', explicit: false, hasLyrics: false, playCount: 9000 - i * 100,
  };
};

/** 30 seconds of silence (8 kHz, 8-bit, mono), so playback genuinely runs. */
function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n, 128);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(n, 40);
  return buf;
}
const WAV = silentWav(30);

interface Hit { host: 'primary' | 'local'; path: string; query: string; at: number }

/**
 * `primaryDelayMs`: how long the primary remote catalogue takes to answer
 * (it is ranked first on a fresh session). The same-origin catalogue always
 * answers at once; the third (remote mirror) is unreachable.
 */
async function seed(page: Page, baseURL: string, primaryDelayMs = 0): Promise<Hit[]> {
  const pool = TITLES.map((_, i) => song(baseURL, i));
  const hits: Hit[] = [];
  await page.addInitScript(({ fp }) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false, aiDj: false, autoplay: false }, version: 4 }));
    localStorage.setItem('vinax.search.v1', JSON.stringify({ state: { recent: ['kesariya lofi', 'arijit singh'], pinned: [], songSort: 'relevance' }, version: 0 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
    localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { fp: latestNotesFingerprint() });

  const answer = (path: string, query: string) => {
    const q = query.toLowerCase();
    const songs = pool.filter((s) => s.title.toLowerCase().includes(q) || s.subtitle.toLowerCase().includes(q));
    const list = songs.length ? songs : pool;
    if (/\/search$/.test(path)) {
      return {
        data: {
          songs: { results: list },
          artists: { results: [{ id: 'ar-k', name: 'Kesar Band', image: [{ quality: '500x500', url: `${baseURL}/icons/icon.svg` }] }] },
          albums: { results: [
            { id: 'al-k1', name: 'Kesariya Nights', subtitle: 'Various artists', language: 'hindi', image: [{ quality: '500x500', url: `${baseURL}/icons/icon.svg` }] },
            { id: 'al-k2', name: 'Kesari Telugu Hits', subtitle: 'Various artists', language: 'telugu', image: [{ quality: '500x500', url: `${baseURL}/icons/icon.svg` }] },
          ] },
          playlists: { results: [] },
        },
      };
    }
    if (path.includes('/search/songs') || path.includes('/suggestions')) return { data: { results: list } };
    return { data: { results: [] } };
  };

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const local = url.origin.startsWith('http://localhost');
    if (local && url.pathname === '/e2e-silence.wav') return route.fulfill({ body: WAV, contentType: 'audio/wav' });
    // The primary remote catalogue speaks /api/search…; the remote mirror
    // speaks /api/cat/… and is left unreachable.
    const primary = !local && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/cat/');
    if (primary || (local && url.pathname.startsWith('/api/cat/'))) {
      const path = url.pathname.replace(/^\/api(\/cat)?/, '');
      const query = url.searchParams.get('query') ?? '';
      hits.push({ host: primary ? 'primary' : 'local', path, query, at: Date.now() });
      if (primary && primaryDelayMs > 0) await new Promise((r) => setTimeout(r, primaryDelayMs));
      // The page may have aborted the request meanwhile (a lost hedge).
      return route.fulfill({ json: answer(path, query) }).catch(() => undefined);
    }
    if (!local) return route.abort();
    if (url.pathname === '/api/trending-searches') return route.fulfill({ json: { queries: ['kesariya reprise', 'telugu hits'] } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return hits;
}

const combobox = (page: Page) => page.getByRole('combobox', { name: 'Search music' });
const activeId = (page: Page) => combobox(page).getAttribute('aria-activedescendant');
const queueState = (page: Page) =>
  page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}').state ?? {};
    return { ids: ((st.queue ?? []) as Array<{ id: string }>).map((s) => s.id), index: st.index as number };
  });

test('typeahead: completions and quick hits appear as you type, and the keyboard drives them', async ({ page, baseURL }) => {
  await seed(page, baseURL!);
  await page.goto('/search');
  const box = combobox(page);
  await expect(box).toBeVisible({ timeout: 20_000 });
  await box.click();
  await page.keyboard.type('kes', { delay: 30 });

  const list = page.locator('#search-suggest');
  await expect(list).toBeVisible({ timeout: 5000 });
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  // Completions: a recent and a trending term, the typed part in bold.
  await expect(list.getByRole('option', { name: /kesariya lofi/i })).toBeVisible();
  await expect(list.getByRole('option', { name: /kesariya reprise/i })).toBeVisible();
  await expect(list.locator('.search-hl').first()).toHaveText(/kes/i);
  // Quick hits, grouped.
  await expect(list.getByRole('group', { name: 'Songs' }).getByRole('option').first()).toBeVisible();
  await expect(list.getByRole('group', { name: 'Artists' }).getByRole('option', { name: /Kesar Band/ })).toBeVisible();
  await expect(list.getByRole('group', { name: 'Albums' }).getByRole('option').first()).toBeVisible();
  // Pinned language first among albums.
  await expect(list.getByRole('group', { name: 'Albums' }).getByRole('option').first()).toContainText('Kesari Telugu Hits');

  // ↓ ↓ ↑ walk the options; the field names the active one.
  await page.keyboard.press('ArrowDown');
  const first = await activeId(page);
  expect(first).toBeTruthy();
  await expect(page.locator(`[id="${first}"]`)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  const second = await activeId(page);
  expect(second).not.toBe(first);
  await page.keyboard.press('ArrowUp');
  expect(await activeId(page)).toBe(first);

  // Escape closes; typing opens it again.
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(box).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.type('a', { delay: 30 });
  await expect(list).toBeVisible();

  // Walk down to the first song hit and press Enter: it plays.
  const songs = list.getByRole('group', { name: 'Songs' }).getByRole('option');
  await expect(songs.first()).toBeVisible();
  const songId = await songs.first().getAttribute('id');
  for (let i = 0; i < 12 && (await activeId(page)) !== songId; i += 1) await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe(songId);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await queueState(page)).ids.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(list).toBeHidden();
  await page.screenshot({ path: 'test-results/v101-typeahead.png' });
});

test('results: the Top result card comes first and its play button plays', async ({ page, baseURL }) => {
  await seed(page, baseURL!);
  await page.goto('/search/kesariya');
  const top = page.getByRole('region', { name: 'Top result' });
  await expect(top).toBeVisible({ timeout: 20_000 });
  await expect(top).toContainText('Kesariya');
  await expect(top).toContainText('Song');
  // Sections follow in order: Songs, Artists, Albums.
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.search-results h2')).map((h) => h.textContent?.trim()),
  );
  expect(order.slice(0, 4)).toEqual(['Top result', 'Songs', 'Artists', 'Albums']);
  await expect(page.getByRole('button', { name: 'See all songs' })).toBeVisible();
  await top.getByRole('button', { name: /^Play Kesariya/ }).click();
  await expect.poll(async () => (await queueState(page)).ids[0], { timeout: 10_000 }).toBe('s0');
  // "See all" switches the existing filter tab.
  await page.getByRole('button', { name: 'See all albums' }).click();
  await expect(page.getByRole('group', { name: 'Search filters' }).getByRole('button', { name: 'Albums' })).toHaveAttribute('aria-pressed', 'true');
});

test('allotment: a stalled first endpoint is hedged, the answer comes from the next one', async ({ page, baseURL }) => {
  const hits = await seed(page, baseURL!, 3000);
  const aborted: string[] = [];
  page.on('requestfailed', (r) => {
    const u = new URL(r.url());
    if (u.searchParams.get('query') === 'kesariya') aborted.push(u.pathname);
  });
  // A deep link: the interactive search starts on a fresh session, where
  // the primary remote catalogue is ranked first.
  await page.goto('/search/kesariya');
  await expect(page.getByRole('region', { name: 'Top result' })).toBeVisible({ timeout: 20_000 });
  const shownAt = Date.now();

  const forQuery = hits.filter((h) => h.path === '/search' && h.query === 'kesariya');
  expect(forQuery.map((h) => h.host)).toEqual(['primary', 'local']);
  const gap = forQuery[1].at - forQuery[0].at;
  // Fired at the primary's p75 (bounded 350–900 ms), well before its 3 s stall ended.
  expect(gap).toBeGreaterThanOrEqual(250);
  expect(gap).toBeLessThan(1500);
  // The results were on screen before the stalled endpoint would have answered.
  expect(shownAt).toBeLessThan(forQuery[0].at + 3000);
  // The loser was aborted, not left to finish.
  await expect.poll(() => aborted.length, { timeout: 5000 }).toBeGreaterThan(0);
});
