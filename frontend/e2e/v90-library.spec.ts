import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 9.0 "Encore" Library and entity pages, driven from seeded local state with
 * every /api call answered `{}`: the shortcuts carry live counts; a playlist
 * row's ⋯ menu pins it to the top and deletes it with an Undo; a saved album
 * leaves the library from its menu (and comes back on Undo); search reaches
 * liked songs; the layout switch announces its state; the Backup Center and
 * device handoff open from the Library; History's scoped clears live in its
 * ⋯ menu; Liked songs can be searched; and nothing scrolls sideways on a
 * phone even with a very long playlist name and Indic titles.
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
const mk = (base: string, id: string, title: string, artist: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: { id: 'al1', name: 'Album One' },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: 5, ...extra,
});

const LONG = 'A very long playlist name for the monsoon evenings drive back home from the coast';

async function seed(page: Page, baseURL: string, theme: 'dark' | 'light' | 'amoled'): Promise<void> {
  const songs = [
    mk(baseURL, 's1', 'Samajavaragamana', 'Sid Sriram'),
    mk(baseURL, 's2', 'Naatu Naatu', 'Rahul Sipligunj'),
    mk(baseURL, 's3', 'Kesariya', 'Arijit Singh', { language: 'hindi' }),
    mk(baseURL, 's4', 'మనసే మౌనం', 'హరిణి'),
  ];
  const now = Date.now();
  await page.addInitScript(
    ({ songs, theme, fp, now, long }) => {
      if (localStorage.getItem('v90-seeded')) return;
      localStorage.setItem('v90-seeded', '1');
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme, pinnedLanguages: ['telugu'], festivalSkins: false }, version: 3 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({
        state: {
          favorites: [songs[0], songs[2], songs[3]],
          saved: [{ id: 'al9', kind: 'album', title: 'Monsoon Album', subtitle: 'Some Composer', image: null, savedAt: now - 5000 }],
          hiddenSongIds: [], later: [songs[1]], hiddenArtists: [], trash: [],
          collections: [
            { id: 'c1', name: 'Road trip', createdAt: now - 3000, songs: [songs[0], songs[1]] },
            { id: 'c2', name: 'Chill', createdAt: now - 2000, songs: [songs[2]] },
            { id: 'c3', name: long, createdAt: now - 1000, songs: [songs[3], songs[0], songs[1], songs[2]] },
          ],
        },
        version: 0,
      }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({
        state: { entries: [{ song: songs[0], ts: now - 600_000, completed: true }, { song: songs[2], ts: now - 2 * 86_400_000, completed: true }] },
        version: 0,
      }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { songs, theme, fp: latestNotesFingerprint(), now, long: LONG },
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/cat/')) return route.fulfill({ json: { data: { results: [] } } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);
/** Neither the document nor the workspace scroller may scroll sideways. */
const noSideways = (page: Page) =>
  page.evaluate(() => {
    const main = document.getElementById('main-content');
    return document.documentElement.scrollWidth <= window.innerWidth && (!main || main.scrollWidth <= main.clientWidth + 1);
  });
/** Names of the Library list's rows, top to bottom. */
const rowTitles = (page: Page) => page.locator('.vx-lp-row:not(.is-trashed) .vx-lp-row-title .t').allInnerTexts();

const SIZES = [
  { width: 390, height: 844, theme: 'light' as const },
  { width: 1440, height: 1000, theme: 'dark' as const },
  { width: 390, height: 844, theme: 'amoled' as const },
];

for (const size of SIZES) {
  const tag = `${size.width}-${size.theme}`;

  test(`library: counts, pin and delete with undo, saved album, search, layout (${tag})`, async ({ page, baseURL }) => {
    await page.setViewportSize(size);
    await seed(page, baseURL!, size.theme);
    await page.goto('/library');
    await expect(page.locator('h1', { hasText: 'Your library' })).toBeVisible();

    // Shortcuts with live counts.
    const shortcuts = page.getByRole('navigation', { name: 'Your collection shortcuts' });
    await expect(shortcuts).toContainText(/Liked songs\s*3 songs/);
    await expect(shortcuts).toContainText(/Listen later\s*1 song/);
    await expect(shortcuts).toContainText(/History\s*2 plays/);

    // Recently added first: the long-named playlist, then Chill, Road trip.
    await expect.poll(() => rowTitles(page)).toEqual([LONG, 'Chill', 'Road trip', 'Monsoon Album']);
    expect(await noSideways(page)).toBe(true);

    // Pin Road trip: it moves to the top and says so.
    await page.getByRole('button', { name: 'More actions for Road trip' }).click();
    await page.getByRole('menuitem', { name: 'Pin to the top' }).click();
    await expect.poll(() => rowTitles(page)).toEqual(['Road trip', LONG, 'Chill', 'Monsoon Album']);
    await expect(page.locator('.vx-lp-row', { hasText: 'Road trip' })).toContainText('Pinned');

    // Delete Chill from its menu, then Undo.
    await page.getByRole('button', { name: 'More actions for Chill' }).click();
    await page.getByRole('menuitem', { name: 'Delete playlist' }).click();
    await expect.poll(() => rowTitles(page)).toEqual(['Road trip', LONG, 'Monsoon Album']);
    await expect.poll(() => bodyText(page)).toMatch(/Recently deleted/);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => rowTitles(page)).toContain('Chill');

    // A saved album leaves from its menu and returns on Undo.
    await page.getByRole('button', { name: 'More actions for Monsoon Album' }).click();
    await page.getByRole('menuitem', { name: 'Remove from your library' }).click();
    await expect.poll(() => rowTitles(page)).not.toContain('Monsoon Album');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => rowTitles(page)).toContain('Monsoon Album');

    // Filter chips narrow the list.
    await page.getByRole('button', { name: 'Albums', exact: true }).click();
    await expect.poll(() => rowTitles(page)).toEqual(['Monsoon Album']);
    await page.getByRole('button', { name: 'All', exact: true }).click();

    // Search reaches liked songs too.
    await page.getByLabel('Search favorites, saved music and collections').fill('kesariya');
    await expect.poll(() => bodyText(page)).toMatch(/1 song match “kesariya”/);
    await expect(page.locator('.vx-track-row', { hasText: 'Kesariya' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear search' }).click();

    // The layout switch announces its state, and the grid shows cards.
    const grid = page.getByRole('button', { name: 'Grid view' });
    await expect(grid).toHaveAttribute('aria-pressed', 'false');
    await grid.click();
    await expect(grid).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.vx-lp-card')).toHaveCount(4);
    await page.screenshot({ path: `test-results/v90-library-grid-${tag}.png`, fullPage: true });
    expect(await noSideways(page)).toBe(true);
  });

  test(`library: create a playlist, Backup Center and device handoff entry points (${tag})`, async ({ page, baseURL }) => {
    await page.setViewportSize(size);
    await seed(page, baseURL!, size.theme);
    await page.goto('/library');
    // Scoped to the workspace: the sidebar has its own instant "Create playlist".
    await page.locator('#main-content').getByRole('button', { name: 'Create playlist' }).click();
    await page.getByLabel('New collection name').fill('Fresh one');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => rowTitles(page)).toContain('Fresh one');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vinax.library.v1') ?? '{}').state.collections.length as number)).toBe(4);

    await page.getByRole('button', { name: 'Backup Center', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Backup Center' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Backup Center' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Move to a new device', exact: true })).toHaveAttribute('href', '/handoff');
  });

  test(`history menu, liked-songs search, collection reorder (${tag})`, async ({ page, baseURL }) => {
    await page.setViewportSize(size);
    await seed(page, baseURL!, size.theme);

    await page.goto('/history');
    await expect(page.locator('h1', { hasText: 'Recently played' })).toBeVisible();
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'More actions' })).toContainText(/Clear last hour[\s\S]*Clear today[\s\S]*Clear all history/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await page.goto('/favorites');
    await page.fill('#liked-search', 'హరిణి');
    await expect.poll(() => bodyText(page)).toMatch(/1 song match/);
    await expect(page.getByRole('button', { name: 'Play these 1' })).toBeVisible();
    await page.fill('#liked-search', 'nothing like this');
    await expect.poll(() => bodyText(page)).toMatch(/None of your liked songs matches/);

    await page.goto('/collection/c1');
    await expect(page.locator('h1', { hasText: 'Road trip' })).toBeVisible();
    if (size.width < 768) {
      // Phones: Move up / down appear only in Reorder mode.
      await expect(page.getByRole('button', { name: 'Move down' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Reorder' }).click();
    }
    await page.getByRole('button', { name: 'Move down' }).first().click({ force: true });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vinax.library.v1') ?? '{}').state.collections[0].songs.map((s: { id: string }) => s.id).join(','))).toBe('s2,s1');
    expect(await noSideways(page)).toBe(true);
  });
}
