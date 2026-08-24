import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * Smoke suite — the app's spine, offline-deterministic. Every request that
 * leaves localhost is aborted, so these tests prove the shell, routing,
 * onboarding and fail-soft paths work from the shipped bundle alone.
 */

/** Abort everything non-local — the app must degrade, never break. */
async function goOffline(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://localhost') || url.startsWith('data:')) return route.continue();
    return route.abort();
  });
}

/** Pretend onboarding already happened (most tests don't re-walk it). Also
 *  stamps the What's-New fingerprint — otherwise its sheet overlays the app
 *  and swallows every click. */
async function markOnboarded(page: Page): Promise<void> {
  await page.addInitScript((fp) => {
    window.localStorage.setItem('vinax.onboarded.v1', 'true');
    window.localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
    window.localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, latestNotesFingerprint());
}

test('first run walks onboarding: name gate → tour → app shell', async ({ page }) => {
  await goOffline(page);
  await page.goto('/');

  // The welcome step demands a name before anything else.
  await expect(page.getByText('Music tuned to you')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Name is mandatory', { exact: false })).toBeVisible();

  await page.getByLabel('What should we call you?').fill('Tester');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Catalog unreachable → the taste-seed step silently yields to the tour.
  await expect(page.getByText('Welcome to VinaX')).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();

  // Sheet gone, app shell alive.
  await expect(page.getByText('Music tuned to you')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('bottom navigation reaches Search and the box accepts typing', async ({ page }) => {
  await markOnboarded(page);
  await goOffline(page);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByText('Search').click();
  const box = page.getByPlaceholder('Songs, albums, artists, playlists…');
  await expect(box).toBeVisible();
  await box.fill('tum hi ho');
  await expect(box).toHaveValue('tum hi ho');
});

test('Settings renders its control surface', async ({ page }) => {
  await markOnboarded(page);
  await goOffline(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Recommendations' })).toBeVisible();
  await expect(page.getByText('Explore mode', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your Data' })).toBeVisible();
  await expect(page.getByText('Move to a new device', { exact: true }).first()).toBeVisible();
});

test('handoff fails soft when no relay is reachable', async ({ page }) => {
  await markOnboarded(page);
  await goOffline(page);
  await page.goto('/handoff');
  await expect(page.getByRole('heading', { name: 'Move to a new device' })).toBeVisible();
  await page.getByRole('button', { name: 'Create transfer' }).click();
  // vite preview answers the POST with the SPA shell (HTML, not JSON) — the
  // page must land on its honest error state, never a crash or a spinner.
  await expect(
    page.getByText(/Couldn’t create the transfer|isn’t enabled on this server/).first(),
  ).toBeVisible({ timeout: 20_000 });
});

test('persisted light theme applies before hydration (no dark flash)', async ({ page }) => {
  await markOnboarded(page);
  await page.addInitScript(() => {
    const raw = localStorage.getItem('vinax.settings.v1');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 99 };
    parsed.state = { ...parsed.state, theme: 'light' };
    localStorage.setItem('vinax.settings.v1', JSON.stringify(parsed));
  });
  await goOffline(page);
  await page.goto('/settings');
  // The inline pre-paint script (index.html) must have classed <html> — if
  // only the React effect did it, DOMContentLoaded-time checks would flake.
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  const bg = await page.evaluate(() => document.documentElement.style.background);
  expect(bg).toContain('rgb(240, 242, 247)');
});

test('back-navigation restores the scroll position (P0-3)', async ({ page }) => {
  await markOnboarded(page);
  await goOffline(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Recommendations' })).toBeVisible();
  // Scroll the app's real scroller (overflow <main>), then navigate away.
  await page.evaluate(() => {
    const main = document.getElementById('main-content');
    if (main) main.scrollTop = 600;
  });
  await page.getByRole('link', { name: 'Home', exact: true }).first().click();
  await page.waitForURL('**/');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Recommendations' })).toBeVisible();
  // The restore polls rAF until the page is tall enough — give it a beat.
  await expect
    .poll(async () => page.evaluate(() => document.getElementById('main-content')?.scrollTop ?? 0), {
      timeout: 5_000,
    })
    .toBeGreaterThan(500);
});

test('taste profile page renders for a cold profile', async ({ page }) => {
  await markOnboarded(page);
  await goOffline(page);
  await page.goto('/taste-profile');
  await expect(page.getByRole('heading', { name: 'Your Taste Profile' })).toBeVisible();
  // C3 dials render even with zero listening signal.
  await expect(page.getByRole('heading', { name: 'Fine-tune your mix' })).toBeVisible();
  await expect(page.getByText('Adventurous', { exact: true }).first()).toBeVisible();
});

test('invite link joins as guest without crashing (M-SRV-2 contract)', async ({ page }) => {
  await markOnboarded(page);
  const crashes: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('TypeError')) crashes.push(m.text());
  });
  // The server sends guests memberCount ONLY — never member names. The client
  // used to read d.members (undefined) and crash the page on the first poll,
  // for every shared invite link.
  await page.route('**/api/room**', (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { ok: true } });
    return route.fulfill({
      json: {
        room: { host_name: 'Host', song: null, position: 0, playing: false, updated_at: new Date().toISOString(), queue: [], requests: [] },
        memberCount: 2,
        reactions: [],
      },
    });
  });
  await page.route(/saavn|lrclib/, (route) => route.abort());
  await page.goto('/together?code=ABCDEF');
  // The guest poll runs every 2s — survive several ticks.
  await page.waitForTimeout(5000);
  await expect(page.getByText('2 listening')).toBeVisible();
  await expect(page.getByText('Something hit a wrong note')).not.toBeVisible();
  expect(crashes).toEqual([]);
});

test('mood x language hub route renders (SEO category layer)', async ({ page }) => {
  await markOnboarded(page);
  await goOffline(page);
  await page.goto('/telugu-romantic-songs');
  await expect(page.getByRole('heading', { name: 'Telugu Romantic Songs' })).toBeVisible();
  // Internal-link mesh: sibling moods + other languages + parent hub.
  await expect(page.getByRole('link', { name: 'Telugu sad songs' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Hindi romantic songs' })).toBeVisible();
});

test('queue rows drag-reorder with the grip handle', async ({ page }) => {
  await markOnboarded(page);
  // Seed a persisted queue (playing s0, three upcoming) — merge() validates it.
  await page.addInitScript(() => {
    const song = (id: string, title: string) => ({
      kind: 'song', id, title, subtitle: 'Artist', artists: [], album: null,
      images: [], audio: [], duration: 200, language: 'telugu', year: '2024',
      explicit: false, hasLyrics: false, playCount: null,
    });
    window.localStorage.setItem('vinax.player.v1', JSON.stringify({
      state: {
        queue: [song('s0', 'Now Playing Song'), song('s1', 'First Up'), song('s2', 'Second Up'), song('s3', 'Third Up')],
        index: 0, repeat: 'off', shuffle: false, volume: 1, muted: false, rate: 1,
      },
      version: 1,
    }));
  });
  await goOffline(page);
  await page.goto('/queue');
  await expect(page.getByRole('heading', { name: 'Up next — and why' })).toBeVisible();

  const rows = page.locator('li').filter({ has: page.getByRole('button', { name: /^Reorder/ }) });
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('First Up');

  // Drag Second Up's grip onto the first slot. (The middle row: the last
  // row's handle can sit under the fixed bottom player bar at 720p, where
  // mouse events land on the bar instead of the handle.)
  const grip = page.getByRole('button', { name: /Reorder Second Up/ });
  const target = rows.nth(0);
  const g = await grip.boundingBox();
  const t = await target.boundingBox();
  if (!g || !t) throw new Error('missing boxes');
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + 4, { steps: 8 });
  await page.mouse.up();

  await expect(rows.nth(0)).toContainText('Second Up');
  await expect(rows.nth(1)).toContainText('First Up');

  // Keyboard fallback: ArrowDown moves it back one slot.
  await page.getByRole('button', { name: /Reorder Second Up/ }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(0)).toContainText('First Up');
  await expect(rows.nth(1)).toContainText('Second Up');
});
