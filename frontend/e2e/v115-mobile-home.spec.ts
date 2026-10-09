import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 11.5.0 — Home scrolling on a phone, driven by a REAL finger (CDP touch
 * events go through Chromium's input pipeline, so these are the same events
 * a thumb produces) against the built bundle:
 *
 *  - a flick moves the page, every time, all the way to the last section;
 *  - an invisible fixed element injected under <body> (an ad-quality scan, a
 *    measurement helper — the desktop "home stuck at top" report) can no
 *    longer freeze the page: the touch rescue forwards the drag;
 *  - a drag inside one of our own sheets belongs to the sheet, never to
 *    pull-to-refresh, so the page underneath does not move;
 *  - the room reserved at the bottom matches the chrome that is actually
 *    on screen, so the last section clears the dock instead of hiding
 *    under it (and does not float a dead screenful above it either);
 *  - nothing makes the page itself scroll sideways.
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

async function seed(page: Page, baseURL: string): Promise<void> {
  const songs = Array.from({ length: 16 }, (_, i) => mk(baseURL, `s${i}`, `Song ${i}`, `Artist ${i % 5}`));
  const stored = songs.map((s) => ({ ...s, artists: s.artists }));
  const entries = stored.slice(0, 8).map((song, i) => ({ song, ts: Date.now() - i * 3_600_000, completed: true }));
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
    { stored, entries, fp: latestNotesFingerprint() },
  );
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/cat/')) return route.fulfill({ json: { data: { results: songs } } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

/** One finger, dragged from a to b. */
async function swipe(page: Page, from: [number, number], to: [number, number], steps = 14): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, x: number, y: number): Promise<unknown> =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
    } as never);
  await send('touchStart', from[0], from[1]);
  for (let i = 1; i <= steps; i += 1) {
    await send('touchMove', from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    await page.waitForTimeout(16);
  }
  await send('touchEnd', to[0], to[1]);
  await cdp.detach();
}

const scrollTop = (page: Page): Promise<number> => page.evaluate(() => document.querySelector('#main-content')!.scrollTop);

async function openHome(page: Page, baseURL: string): Promise<void> {
  await seed(page, baseURL);
  await page.goto('/');
  await page.waitForSelector('.vx-hero');
  await page.waitForTimeout(1200);
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('a thumb flicks Home all the way down, and never backwards', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  await openHome(page, baseURL!);
  const more = page.getByRole('button', { name: /Show more for you/ });
  if (await more.count()) {
    await more.click();
    await page.waitForTimeout(800);
  }

  const trail: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    await swipe(page, [195, 700], [195, 220]);
    await page.waitForTimeout(400);
    trail.push(await scrollTop(page));
  }
  // Every flick moves the page forward or holds at the end — never back.
  trail.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(i === 0 ? 1 : trail[i - 1] - 2));
  expect(trail[trail.length - 1]).toBeGreaterThan(2000);
  // The bottom is reachable.
  const end = await page.evaluate(() => {
    const m = document.querySelector('#main-content') as HTMLElement;
    return m.scrollHeight - m.clientHeight - m.scrollTop;
  });
  expect(end).toBeLessThan(40);
});

test('an injected blocker under <body> cannot freeze Home', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await openHome(page, baseURL!);
  // What a third-party script parks on the page: invisible, fixed, outside
  // #root, swallowing every touch that lands on it.
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'injected-blocker';
    d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent';
    document.body.appendChild(d);
  });
  const before = await scrollTop(page);
  await swipe(page, [195, 700], [195, 300]);
  await page.waitForTimeout(500);
  expect(await scrollTop(page)).toBeGreaterThan(before + 100);
});

test('a drag inside one of our sheets belongs to the sheet, not to pull-to-refresh', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await openHome(page, baseURL!);
  await page.evaluate(() => document.querySelector('#main-content')!.scrollTo(0, 0));
  await page.getByRole('button', { name: /Notifications/i }).first().click();
  const sheet = page.locator('[role="dialog"]').first();
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  // A downward drag inside the sheet, at the very top of the page: exactly
  // the gesture pull-to-refresh used to steal.
  await swipe(page, [Math.round(box.x + box.width / 2), Math.round(box.y + 40)], [Math.round(box.x + box.width / 2), Math.round(box.y + box.height - 40)]);
  await page.waitForTimeout(400);
  const pulled = await page.evaluate(() => {
    const home = document.querySelector('.vx-home');
    const wrap = home?.parentElement?.parentElement as HTMLElement | undefined;
    return wrap?.style.transform ?? '';
  });
  expect(pulled).toBe('');
});

test('the bottom reserve matches the chrome that is really on screen', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await openHome(page, baseURL!);
  const m = await page.evaluate(() => {
    const chrome = document.querySelector('.vx-dock')!.parentElement as HTMLElement;
    const reserve = getComputedStyle(document.documentElement).getPropertyValue('--player-safe-offset').trim();
    return { chromeH: chrome.getBoundingClientRect().height, reserve };
  });
  expect(m.reserve).toBe(`${Math.round(m.chromeH)}px`);

  // Keep going to the end until the page stops growing under us: blocks
  // mount as they are approached, so one scrollTo is not the bottom yet.
  let height = 0;
  for (let i = 0; i < 20; i += 1) {
    const h = await page.evaluate(() => {
      const el = document.querySelector('#main-content') as HTMLElement;
      el.scrollTo(0, el.scrollHeight);
      return el.scrollHeight;
    });
    await page.waitForTimeout(350);
    if (h === height) break;
    height = h;
  }
  const bottom = await page.evaluate(() => {
    const chrome = document.querySelector('.vx-dock')!.parentElement as HTMLElement;
    const last = document.querySelector('.vx-home')!.lastElementChild as HTMLElement;
    return { lastBottom: last.getBoundingClientRect().bottom, chromeTop: chrome.getBoundingClientRect().top };
  });
  // Clear of the dock, and not a dead screenful above it either.
  expect(bottom.lastBottom).toBeLessThanOrEqual(bottom.chromeTop);
  expect(bottom.chromeTop - bottom.lastBottom).toBeLessThan(80);
});

test('Home never scrolls sideways', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await openHome(page, baseURL!);
  const drift = await page.evaluate(() => {
    const m = document.querySelector('#main-content') as HTMLElement;
    m.scrollLeft = 400; // what a focus-into-view does when a card sits off-screen
    return { left: m.scrollLeft, docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth };
  });
  expect(drift.left).toBe(0);
  expect(drift.docScrollW).toBe(drift.docClientW);
});
