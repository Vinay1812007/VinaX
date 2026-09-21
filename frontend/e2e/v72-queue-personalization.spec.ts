import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 7.2 from the built bundle, in a real browser, with Telugu, Hindi and Tamil
 * titles and a phone and a desktop width:
 *  - upcoming entries say whether the DJ picked them or the listener added
 *    them, in words;
 *  - the queue can be reordered from the keyboard, with the result announced
 *    and focus kept on the row that moved;
 *  - removing a song offers an Undo that puts it back;
 *  - "Keep this song" turns a DJ pick into the listener's own;
 *  - "Less like this" asks for how long, and Settings lists the mute and
 *    takes it back.
 *
 * The catalogue is mocked; a real (silent) audio file is served so playback
 * genuinely runs and the DJ builds a continuation the way it does in the app.
 */
interface ApiSong {
  kind: 'song'; id: string; title: string; subtitle: string;
  artists: { primary: Array<{ id: string; name: string }> };
  album: { id: string; name: string };
  image: Array<{ quality: string; url: string }>;
  downloadUrl: Array<{ quality: string; url: string }>;
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}

/** Telugu titles and artist names in their own script, at realistic lengths. */
const TELUGU: Array<[string, string, string]> = [
  ['సామజవరగమన', 'సిద్ శ్రీరామ్', 'అల వైకుంఠపురములో'],
  ['బుట్ట బొమ్మ', 'అర్మాన్ మాలిక్', 'అల వైకుంఠపురములో'],
  ['ఊ అంటావా మావా ఊఊ అంటావా మావా', 'ఇంద్రావతి చౌహాన్', 'పుష్ప: ది రైజ్'],
  ['నాటు నాటు', 'రాహుల్ సిప్లిగంజ్', 'ఆర్ ఆర్ ఆర్'],
  ['కళావతి', 'అనురాగ్ కులకర్ణి', 'సర్కారు వారి పాట'],
  ['ఇంకేం ఇంకేం ఇంకేం కావాలే', 'గోపీ సుందర్', 'గీత గోవిందం'],
  ['శ్రీవల్లి', 'జావేద్ అలీ', 'పుష్ప: ది రైజ్'],
  ['వచ్చిందే', 'మధు ప్రియ', 'ఫిదా'],
  ['రాములో రాముల', 'మంగ్లీ', 'అల వైకుంఠపురములో'],
  ['నీలి నీలి ఆకాశం', 'సునీత ఉపద్రష్ట', '30 రోజుల్లో ప్రేమించటం ఎలా'],
  ['మగువా మగువా', 'శంకర్ మహదేవన్', 'వకీల్ సాబ్'],
  ['ఉండిపోరాదే', 'సిద్ శ్రీరామ్', 'హుషారు'],
];
/** Other scripts, hand-queued so they are not subject to the language lock. */
const HINDI: [string, string, string] = ['तुम ही हो (अनप्लग्ड) — आशिकी दो', 'अरिजीत सिंह', 'आशिकी 2'];
const TAMIL: [string, string, string] = ['ரௌடி பேபி — மாரி இரண்டு', 'தனுஷ்', 'மாரி 2'];

const song = (base: string, id: string, [title, artist, album]: [string, string, string], language: string): ApiSong => ({
  kind: 'song', id, title, subtitle: artist,
  artists: { primary: [{ id: `ar-${id}`, name: artist }] },
  album: { id: `al-${id}`, name: album },
  image: [{ quality: '500x500', url: `${base}/icons/icon.svg` }],
  downloadUrl: [{ quality: '160kbps', url: `${base}/e2e-silence.wav` }],
  duration: 240, language, year: '2021', explicit: false, hasLyrics: false, playCount: 5000,
});

/** 45 seconds of silence: 8 kHz, 8-bit, mono. Playback really runs, so the DJ really builds. */
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
const WAV = silentWav(45);

async function seed(page: Page, baseURL: string): Promise<ApiSong[]> {
  const pool = TELUGU.map((t, i) => song(baseURL, `t${i}`, t, 'telugu'));
  const extras = [song(baseURL, 'h0', HINDI, 'hindi'), song(baseURL, 'm0', TAMIL, 'tamil')];
  const profile = {
    version: 1, createdAt: Date.now() - 40 * 86_400_000, updatedAt: Date.now() - 3_600_000,
    languages: { telugu: { score: 40, plays: 50, completes: 35, skips: 3, lastTs: Date.now() - 86_400_000 }, hindi: { score: 14, plays: 12, completes: 8, skips: 2, lastTs: Date.now() - 86_400_000 } },
    artists: {
      'ar-t0': { score: 30, plays: 20, completes: 15, skips: 1, lastTs: Date.now() - 86_400_000, name: 'సిద్ శ్రీరామ్' },
      'ar-t4': { score: 12, plays: 8, completes: 6, skips: 1, lastTs: Date.now() - 86_400_000, name: 'అనురాగ్ కులకర్ణి' },
    },
    songs: {}, hourHistogram: new Array(24).fill(2), hourBuckets: { telugu: [1, 8, 10, 14] },
    totals: { plays: 62, completes: 43, skips: 9, favorites: 4, queueAdds: 3 },
    recentSongIds: [], skippedSongIds: [], likedSongIds: [], softMuted: {},
  };
  await page.addInitScript(({ fp, profile }) => {
    localStorage.setItem(
      'vinax.settings.v1',
      JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu', 'hindi', 'tamil'], festivalSkins: false, aiDj: false, autoplay: true, djTakeover: true, discoveryMode: 'balanced' }, version: 4 }),
    );
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.user-name', JSON.stringify('Lakshmi'));
    localStorage.setItem('vinax.user-handle', JSON.stringify('lakshmi'));
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    // A listener who has played for a few weeks: the personalization preview has something to say.
    localStorage.setItem('vinax.profile.v1', JSON.stringify(profile));
  }, { fp: latestNotesFingerprint(), profile });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/e2e-silence.wav') return route.fulfill({ body: WAV, contentType: 'audio/wav' });
    if (url.pathname === '/api/cat/search') {
      return route.fulfill({ json: { data: { songs: { results: [...pool, ...extras] }, albums: { results: [] }, artists: { results: [] }, playlists: { results: [] } } } });
    }
    if (url.pathname.startsWith('/api/cat/')) {
      if (url.pathname.includes('/search/songs') || url.pathname.includes('/suggestions')) return route.fulfill({ json: { data: { results: [...pool, ...extras] } } });
      return route.fulfill({ json: { data: { results: [] } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return pool;
}

/**
 * Client-side navigation, the way a tap inside the app navigates. A reload
 * (`page.goto`) starts a fresh app: the queue comes back from storage, but
 * who queued each entry does not — the player keeps that in memory only.
 */
const gotoInApp = (page: Page, path: string) =>
  page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

const queueIds = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}').state?.queue ?? []).map((s: { id: string }) => s.id) as string[]);

/** Start a song from search so the DJ builds a real continuation, then open the queue. */
async function playAndOpenQueue(page: Page): Promise<void> {
  await page.goto('/search/telugu');
  const rows = page.locator('[data-song-id]');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect.poll(() => queueIds(page).then((q) => q.length), { timeout: 25_000 }).toBeGreaterThan(2);
  await gotoInApp(page, '/queue');
  await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible();
}

for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`the queue says who queued what, reorders from the keyboard and undoes a removal (${size.width}px)`, async ({ page, baseURL }) => {
    await page.setViewportSize(size);
    await seed(page, baseURL!);
    await playAndOpenQueue(page);

    // Every upcoming entry the DJ chose is marked in words, not by colour.
    const rows = page.locator('ul li[data-row-key]');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText('DJ pick').first()).toBeVisible();
    await expect(page.locator('#vx-rebuild-note')).toContainText(/DJ picks?\./);

    // Hand-queue a song in another script: it goes ahead of the DJ's picks and says so.
    await gotoInApp(page, '/search/telugu');
    // The overview lists only the first few songs; the Songs tab has them all.
    await page.getByRole('button', { name: /Explore all songs/ }).click();
    const hindiRow = page.locator('[data-song-id]', { hasText: 'तुम ही हो' }).first();
    await hindiRow.scrollIntoViewIfNeeded();
    await hindiRow.getByRole('button', { name: /More options/ }).click();
    await page.getByRole('menuitem', { name: 'Add to queue' }).click();
    await gotoInApp(page, '/queue');
    const mine = page.locator('li[data-row-key]', { hasText: 'तुम ही हो' });
    await expect(mine.getByText('Added by you')).toBeVisible();
    await expect(page.locator('#vx-rebuild-note')).toContainText('added by you');
    // The title does not spill out of its row.
    const spill = await mine.evaluate((li) => li.scrollWidth - li.clientWidth);
    expect(spill).toBeLessThanOrEqual(1);

    // Keyboard reorder: the grip takes arrow keys, announces the move and keeps focus.
    const secondTitle = await rows.nth(1).locator('span.font-bold').first().innerText();
    const grip = rows.nth(1).getByRole('button', { name: /^Reorder / });
    await grip.focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('[role=status]').first()).toContainText('moved to position 1 of');
    await expect(rows.first().locator('span.font-bold').first()).toHaveText(secondTitle);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')).toMatch(/^Reorder /);

    // The same move from the row menu, for a pointer-free path that reads aloud.
    await rows.first().getByRole('button', { name: /^More options for / }).click();
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await expect(page.locator('[role=status]').first()).toContainText('moved to position 2 of');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')).toMatch(/^More options for /);

    // Remove, then Undo: the song comes back where it was.
    const before = await queueIds(page);
    const firstRemove = rows.first().getByRole('button', { name: /^Remove / });
    await firstRemove.click();
    await expect.poll(() => queueIds(page).then((q) => q.length)).toBe(before.length - 1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => queueIds(page)).toEqual(before);
    await page.screenshot({ path: `test-results/v72-queue-${size.width}.png` });
  });
}

test('Keep this song holds a DJ pick through a rebuild', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, baseURL!);
  await playAndOpenQueue(page);

  const pick = page.locator('li[data-row-key]', { has: page.getByText('DJ pick') }).first();
  const keptTitle = await pick.locator('span.font-bold').first().innerText();
  await pick.getByRole('button', { name: /^More options for / }).click();
  await page.getByRole('menuitem', { name: 'Keep this song' }).click();
  const kept = page.locator('li[data-row-key]', { hasText: keptTitle }).first();
  await expect(kept.getByText('Added by you')).toBeVisible();

  // A deliberate rebuild replaces the other DJ picks and leaves this one alone.
  await page.getByRole('button', { name: 'New DJ picks' }).click();
  await expect.poll(() => page.locator('li[data-row-key]', { hasText: keptTitle }).count(), { timeout: 25_000 }).toBe(1);
  await expect(page.locator('li[data-row-key]', { hasText: keptTitle }).first().getByText('Added by you')).toBeVisible();
});

test('Less like this asks for how long; Settings lists the mute and takes it back', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page, baseURL!);
  await page.goto('/search/telugu');
  const row = page.locator('[data-song-id]').first();
  await expect(row).toBeVisible();
  // Whoever the first result is, the menu must name them in their own script.
  const playLabel = (await row.getByRole('button', { name: /^Play / }).getAttribute('aria-label')) ?? '';
  const artist = playLabel.split(' by ').slice(1).join(' by ').trim();
  expect(artist).toMatch(/[\u0C00-\u0C7F\u0900-\u097F\u0B80-\u0BFF]/);

  await row.getByRole('button', { name: /More options/ }).click();
  await expect(page.getByRole('menuitem', { name: 'More like this' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Less like this…' }).click();
  // The menu asks for how long, naming the artist, and the permanent block is not here.
  await expect(page.getByRole('menu')).toContainText(artist);
  // The permanent block is not one of the choices here — only how long.
  await expect(page.getByRole('menuitem', { name: /^Never play/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: '7 days' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '30 days' })).toBeVisible();
  await page.screenshot({ path: 'test-results/v72-less-like-this-1440.png' });
  await page.getByRole('menuitem', { name: '14 days' }).click();
  await expect(page.getByText(new RegExp(`^Less of ${artist} until `))).toBeVisible();

  // Settings shows it with its end date, and unmuting offers an Undo.
  await gotoInApp(page, '/settings');
  const block = page.locator('[data-settings-row]', { hasText: 'Playing less of' });
  await expect(block).toContainText(artist);
  await expect(block).toContainText(/14 days left/);
  await block.getByRole('button', { name: /^Unmute / }).click();
  await expect(block).toContainText('Nothing muted right now');
  // The newest toast is the unmute's own — the mute's toast is still on screen.
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect(block).toContainText(artist);
});

test('Settings explains each discovery mode and what the trending slider changes', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, baseURL!);
  await page.goto('/settings');
  const modes = page.getByRole('group', { name: 'Discovery mode' });
  await expect(modes.getByRole('button', { name: 'Familiar' })).toBeVisible();
  await expect(modes).toContainText('Mostly songs and artists you already play');
  await expect(modes).toContainText('about one new artist in every four or five songs');
  await expect(modes).toContainText('Up to half of a queue from artists you have never played');
  await modes.getByRole('button', { name: 'Familiar' }).click();
  await expect(modes.getByRole('button', { name: 'Familiar' })).toHaveAttribute('aria-pressed', 'true');

  const slider = page.getByLabel('Trending vs. your taste');
  await expect(slider).toBeVisible();
  await expect(page.locator('[data-settings-row]', { hasText: 'Trending vs. your taste' })).toContainText(
    /Mostly your own listening|A mix of what is trending|Mostly what is popular/,
  );
  await expect(page.locator('[data-settings-row]', { hasText: 'What VinaX thinks you like' })).toContainText('Languages');
  await page.screenshot({ path: 'test-results/v72-settings-390.png' });
});
