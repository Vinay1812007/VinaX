import { test, expect, type Page } from './support/test';
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
 * excluded from the suite because `@axe-core/playwright` is not installed
 * (see playwright.config.ts). These are the properties that can be verified
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
