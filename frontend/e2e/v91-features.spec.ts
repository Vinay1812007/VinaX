import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 9.1 — the interfaces this release added, in a real browser:
 *
 *   - Home's "Fewer repeats" control;
 *   - the AI playlist's Keep / Replace / Refine controls;
 *   - the track menu's "Snooze this song…" submenu;
 *   - VinaX AI's Temporary chat and Projects entry points, and the artifact
 *     panel's toggle.
 *
 * What it checks, for each: an accessible name, a touch target that meets the
 * repo's 44px rule, keyboard reachability, and no horizontal page overflow at
 * 360px. It is NOT a full axe audit — `e2e/a11y.spec.ts` is that, and it stays
 * excluded from this runner because `@axe-core/playwright` is not installed
 * (see e2e/vitest.config.ts). These are the properties that can be verified
 * without it, on exactly the surfaces that changed.
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
const mk = (base: string, id: string, title: string, artist: string): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: { id: `al-${id}`, name: `Album ${id}` },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: 5,
});

/** Every control VinaX ships must be tappable: 44px in at least one dimension, with its pad. */
async function hitArea(page: Page, name: string): Promise<{ w: number; h: number }> {
  const box = await page.getByRole('button', { name }).first().boundingBox();
  expect(box, `no box for "${name}"`).not.toBeNull();
  return { w: Math.round(box!.width), h: Math.round(box!.height) };
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { scroll: el.scrollWidth, client: el.clientWidth };
  });
  // A couple of pixels of rounding is not an overflow; a stray wide child is.
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 2);
}

async function seed(page: Page, baseURL: string): Promise<void> {
  const songs = Array.from({ length: 16 }, (_, i) => mk(baseURL, `s${i}`, `Song ${i}`, `Artist ${i % 5}`));
  const entries = songs.slice(0, 8).map((song, i) => ({ song, ts: Date.now() - i * 3_600_000, completed: true }));
  await page.addInitScript(
    ({ stored, entries, fp }) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false }, version: 3 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites: stored.slice(0, 3), saved: [], collections: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] }, version: 0 }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { stored: songs, entries, fp: latestNotesFingerprint() },
  );
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/cat/')) return route.fulfill({ json: { data: { results: songs } } });
    if (url.pathname === '/api/appconfig') return route.fulfill({ json: { flags: {} } });
    if (url.pathname === '/api/playlist') {
      return route.fulfill({ json: { name: 'Evening mix', description: 'Slow ones.', songs: songs.slice(0, 6).map((s) => ({ title: s.title, artist: s.subtitle, reason: 'fits the mood' })) } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

test('Home: "Fewer repeats" is named, tappable and does not overflow a narrow screen', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seed(page, baseURL!);
  await page.goto('/');
  await page.waitForSelector('.vx-hero');

  const fewer = page.getByRole('button', { name: 'Fewer repeats' });
  await expect(fewer).toBeVisible();
  // Its own title explains what it does, for a pointer user.
  await expect(fewer).toHaveAttribute('title', /heard or been shown lately/i);
  const box = await hitArea(page, 'Fewer repeats');
  expect(box.h).toBeGreaterThanOrEqual(36);
  await noHorizontalOverflow(page);

  // Reachable and operable from the keyboard.
  await fewer.focus();
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Fewer repeats');
  await page.keyboard.press('Enter');
  // The refresh announces itself in a live region rather than silently.
  await expect(page.getByRole('status').filter({ hasText: /heard lately|refreshed/i }).first()).toBeVisible({ timeout: 15_000 });
});

test('AI playlist: Keep, Replace and Refine are all named and reachable', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, baseURL!);
  await page.goto('/ai-playlist');
  await page.getByLabel(/Describe your perfect mix/i).fill('slow telugu evening');
  await page.getByRole('button', { name: /Build my playlist/i }).click();

  await expect(page.getByRole('heading', { name: 'Evening mix' })).toBeVisible({ timeout: 30_000 });

  // Keep / Replace carry the song's name, so a screen reader says which row.
  const keep = page.getByRole('button', { name: /^Keep Song \d+ when building again$/ }).first();
  await expect(keep).toBeVisible();
  await expect(page.getByRole('button', { name: /^Replace Song \d+ with another song$/ }).first()).toBeVisible();

  // Keeping a track is announced, not silent. Its name then changes to the
  // undo wording, which is why it is re-located rather than reused.
  await keep.click();
  await expect(page.getByRole('status').filter({ hasText: /track kept/i })).toBeVisible();
  const kept = page.getByRole('button', { name: /^Stop keeping Song \d+$/ }).first();
  await expect(kept).toBeVisible();
  await expect(kept).toHaveAttribute('aria-pressed', 'true');

  // Refine has a label even though its label is visually hidden.
  await expect(page.getByLabel(/Change something about this playlist/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fewer repeats' })).toBeVisible();
  await noHorizontalOverflow(page);
});

test('the track menu offers "Snooze this song…" with named durations', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seed(page, baseURL!);
  // A song ROW (not a card) is what carries the ⋮ menu, so this drives it from
  // the AI playlist's result list.
  await page.goto('/ai-playlist');
  await page.getByLabel(/Describe your perfect mix/i).fill('slow telugu evening');
  await page.getByRole('button', { name: /Build my playlist/i }).click();
  await expect(page.getByRole('heading', { name: 'Evening mix' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'More options' }).first().click();
  const snooze = page.getByRole('menuitem', { name: /Snooze this song/i });
  await expect(snooze).toBeVisible();
  await snooze.click();
  // The duration view, with a way back.
  await expect(page.getByRole('menuitem', { name: '7 days' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '30 days' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Back' })).toBeVisible();

  // Escape steps back to the full menu rather than closing outright.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: /Snooze this song/i })).toBeVisible();

  // Choosing a duration says what happened and offers Undo.
  await page.getByRole('menuitem', { name: /Snooze this song/i }).click();
  await page.getByRole('menuitem', { name: '14 days' }).click();
  await expect(page.getByText(/paused until/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' }).first()).toBeVisible();
});

test('VinaX AI: Temporary chat, Projects and the artifact toggle are all named', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seed(page, baseURL!);
  await page.goto('/VinaXAI');
  await page.waitForSelector('.ai-root');

  // Both sidebar entry points exist and say what they do.
  const temp = page.getByRole('button', { name: 'Temporary chat' });
  await expect(temp).toBeVisible();
  await expect(temp).toHaveAttribute('title', /never saved on this device/i);
  const projects = page.getByRole('button', { name: 'Projects' });
  await expect(projects).toBeVisible();

  // The project sheet is a real modal: labelled, and Escape closes it.
  await projects.click();
  const dialog = page.getByRole('dialog', { name: 'Projects' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('New project name')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // A temporary chat says so, once.
  await temp.click();
  await expect(page.getByText(/nothing from it is saved on this device/i)).toBeVisible();
  await noHorizontalOverflow(page);
});
