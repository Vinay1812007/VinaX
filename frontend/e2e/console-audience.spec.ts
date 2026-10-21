import { test, expect, type Page, type Route } from './support/test';

/**
 * 13.8 — owner console audience pages (/admin/, static files, not the React
 * app): Live, Listeners, Growth & engagement and Places. Every tab renders
 * with realistic fixtures, with a freshly wiped (empty) database, and with a
 * database outage; every write sends the body the server expects
 * (POST /api/admin/maintenance end_room / close_rooms / delete_user); the
 * listener drawer, downloads, server search and paging work; retention
 * percentages are computed from the counts the server sends. All non-local
 * network is aborted (the world map's tiles and geocoder included); zero page
 * or console errors allowed.
 */

const TOKEN = 'owner-pass';
const iso = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
/** Monday (UTC) `weeksAgo` weeks back, as the retention RPC reports cohort weeks. */
const monday = (weeksAgo: number): string => {
  const d = new Date();
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back - 7 * weeksAgo)).toISOString().slice(0, 10);
};
const heat = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 5 && h === 21 ? 50 : (d + h) % 7)));

const ASHA = 'dev-asha-0001-abcdef';

const FULL: Record<string, unknown> = {
  '/api/admin/live': {
    configured: true, count: 2, playing: 1, byCountry: { IN: 1, US: 1 },
    listeners: [
      { name: 'Asha', deviceId: ASHA, city: 'Hyderabad', country: 'IN', platform: 'android', song: 'Naatu Naatu', artist: 'Rahul Sipligunj', image: null, playing: true, lastSeen: iso(0.01) },
      { name: 'Ravi', deviceId: 'dev-ravi-0003', city: 'Edison', country: 'US', platform: 'web', song: null, artist: null, image: null, playing: false, lastSeen: iso(0.02) },
    ],
  },
  '/api/admin/activity': {
    configured: true,
    events: [
      { type: 'play', song_title: 'Naatu Naatu', song_artist: 'Rahul Sipligunj', device_id: ASHA, platform: 'android', country: 'IN', city: 'Hyderabad', created_at: iso(0.01) },
      { type: 'search', song_title: 'arijit', song_artist: null, device_id: 'dev-ravi-0003', platform: 'web', country: 'US', city: 'Edison', created_at: iso(0.05) },
      { type: 'error', song_title: null, song_artist: null, device_id: 'dev-ravi-0003', platform: 'web', country: null, city: null, created_at: iso(0.2) },
    ],
  },
  '/api/admin/rooms': {
    configured: true, active: 1, listeners: 3,
    rooms: [{ code: 'ABCD12', host: 'Asha', playing: true, updated_at: iso(0.02), members: 3, song_title: 'Naatu Naatu', song_artist: 'Rahul Sipligunj' }],
  },
  '/api/admin/realtime': {
    configured: true, startsPerMin: 4, joins5m: 1, errors5m: 1,
    recentErrors: [{ error_kind: 'playback', message: 'Stream URL expired', created_at: iso(0.03) }],
    liveListeners: 2, liveCities: [{ name: 'Asha', city: 'Hyderabad', country: 'IN', current_song_title: 'Naatu Naatu' }],
    aiP50: 1840, aiOkRate: 96, aiCalls15m: 25, activeRooms: 1,
  },
  '/api/admin/users': {
    configured: true, limit: 50, offset: 0, hasMore: false,
    summary: { total_users: 3, active_24h: 2, new_24h: 1, total_plays: 1520, accounts_total: 2 },
    users: [
      { device_id: ASHA, name: 'Asha', username: 'asha', platform: 'android', country: 'IN', city: 'Hyderabad', is_playing: true, first_seen: iso(240), last_seen: iso(0.01), signed_in: true, email: 'asha@example.com', picture: null },
      { device_id: 'dev-ravi-0003', name: 'Ravi', username: null, platform: 'web', country: 'US', city: 'Edison', is_playing: false, first_seen: iso(30), last_seen: iso(3) },
      { device_id: 'account:1122', kind: 'account', name: 'Kiran', username: 'kiran', email: 'kiran@example.com', picture: null, platform: 'web', country: 'IN', region: 'Telangana', city: 'Warangal', app_version: null, is_playing: false, first_seen: iso(48), last_seen: iso(47) },
    ],
  },
  '/api/admin/user': {
    configured: true,
    user: { device_id: ASHA, name: 'Asha', username: 'asha', platform: 'android', country: 'IN', city: 'Hyderabad', region: 'Telangana', app_version: '13.7.4', is_playing: true, first_seen: iso(240), last_seen: iso(0.01), current_song_title: 'Naatu Naatu', current_song_artist: 'Rahul Sipligunj', signed_in: true, email: 'asha@example.com', picture: null, account_created: iso(200) },
    events: [
      { type: 'play', song_title: 'Naatu Naatu', song_artist: 'Rahul Sipligunj', language: 'telugu', created_at: iso(0.01), country: 'IN', city: 'Hyderabad' },
      { type: 'play', song_title: 'Naatu Naatu', song_artist: 'Rahul Sipligunj', language: 'telugu', created_at: iso(1), country: 'IN', city: 'Hyderabad' },
      { type: 'favorite', song_title: 'Kesariya', song_artist: 'Arijit Singh', language: 'hindi', created_at: iso(2), country: 'IN', city: 'Hyderabad' },
    ],
  },
  '/api/admin/insights': {
    configured: true, days: 7,
    segments: { new_7d: 12, returning_7d: 30, inactive_30d: 9, power_users: 5 },
    playsByHour: [],
    trending: [{ song_title: 'Naatu Naatu', song_artist: 'Rahul Sipligunj', song_image: null, plays: 40, prev_plays: 10 }],
    topListeners: [{ device_id: ASHA, name: 'Asha', username: 'asha', plays: 120 }, { device_id: 'dev-ravi-0003', name: null, username: 'ravi', plays: 60 }],
    languages: [{ language: 'telugu', plays: 300, listeners: 20 }, { language: 'hindi', plays: 120, listeners: 25 }],
  },
  '/api/admin/growth': { configured: true, days: [0, 1, 0, 2, 3, 1, 0, 4, 2, 5, 1, 0, 3, 2], last14: 24, prev14: 16, sampled: false },
  '/api/admin/overview': { configured: true, summary: { total_users: 140 }, accounts: { total: 22, newToday: 2, active7d: 15 } },
  '/api/admin/retention': {
    configured: true,
    // Counts, not fractions: 42 of 120 came back on day 1 → 35%; 38 of 88 → 43%.
    cohorts: [
      { cohort_week: monday(3), cohort_size: 120, d1: 42, d7: 30, d30: 6 },
      { cohort_week: monday(7), cohort_size: 88, d1: 38, d7: 19, d30: 11 },
    ],
  },
  '/api/admin/funnel': {
    configured: true, days: 7, sampled: 100, source: 'exact',
    steps: [
      { id: 'open', label: 'Opened the app', devices: 100, pct: 100 },
      { id: 'register', label: 'Chose a name', devices: 40, pct: 40 },
      { id: 'play', label: 'Played a song', devices: 80, pct: 80 },
      { id: 'complete', label: 'Finished a song', devices: 55, pct: 55 },
      { id: 'favorite', label: 'Liked a song', devices: 20, pct: 20 },
      { id: 'search', label: 'Searched', devices: 70, pct: 70 },
      { id: 'share', label: 'Shared', devices: 5, pct: 5 },
    ],
  },
  '/api/admin/engagement': {
    configured: true, days: 7, plays: 1200, skips: 300, completes: 700, favorites: 90, downloads: 40, shares: 12,
    skipRate: 20, completionRate: 58, repeatRate: 14, avgPlaysPerUser: 9.4, retention: { d1: 33, d7: 18, d30: null }, totalUsers: 140,
  },
  '/api/admin/usage': {
    configured: true, days: 7, sampled: 4200, source: 'exact',
    byType: [{ type: 'heartbeat', n: 3000, devices: 80 }, { type: 'play', n: 1200, devices: 90 }, { type: 'search', n: 600, devices: 70 }],
    byPlatform: [{ platform: 'web', n: 3000 }, { platform: 'android', n: 1900 }],
    heatmap: heat, peak: { day: 5, hour: 21, n: 50 },
  },
  '/api/admin/digest': {
    configured: true, created_at: iso(30),
    digest: { week_of: '2026-10-12', active_listeners: 140, new_listeners: 24, plays: 5200, searches: 900, errors: 3, top_song: 'Naatu Naatu', top_search: 'arijit', sampled: false, ts: 1 },
  },
  '/api/admin/location': {
    configured: true, days: 7,
    countries: [{ country: 'IN', listeners: 30 }, { country: 'US', listeners: 6 }],
    cities: [{ country: 'IN', city: 'Hyderabad', listeners: 18, plays: 400 }, { country: 'US', city: 'Edison', listeners: 6, plays: 70 }],
    platforms: [{ platform: 'web', listeners: 100 }, { platform: 'android', listeners: 40 }],
  },
};

/** A freshly wiped database: every endpoint configured, nothing in it. */
const EMPTY: Record<string, unknown> = {
  '/api/admin/live': { configured: true, count: 0, playing: 0, byCountry: {}, listeners: [] },
  '/api/admin/activity': { configured: true, events: [] },
  '/api/admin/rooms': { configured: true, rooms: [], active: 0, listeners: 0 },
  '/api/admin/realtime': { configured: true, startsPerMin: 0, joins5m: 0, errors5m: 0, recentErrors: [], liveListeners: 0, liveCities: [], aiP50: null, aiOkRate: null, aiCalls15m: 0, activeRooms: 0 },
  '/api/admin/users': { configured: true, users: [], summary: { total_users: 0, active_24h: 0, new_24h: 0, total_plays: 0, accounts_total: 0 }, limit: 50, offset: 0, hasMore: false },
  '/api/admin/user': { configured: true, user: null, events: [] },
  '/api/admin/insights': { configured: true, days: 7, segments: { new_7d: 0, returning_7d: 0, inactive_30d: 0, power_users: 0 }, playsByHour: [], trending: [], topListeners: [], languages: [] },
  '/api/admin/growth': { configured: true, days: Array(14).fill(0), last14: 0, prev14: 0, sampled: false },
  '/api/admin/overview': { configured: true, summary: { total_users: 0 }, accounts: { total: 0, newToday: 0, active7d: 0 } },
  '/api/admin/retention': { configured: true, cohorts: [] },
  '/api/admin/funnel': { configured: true, days: 7, sampled: 0, source: 'exact', steps: ['open', 'register', 'play', 'complete', 'favorite', 'search', 'share'].map((id) => ({ id, label: id, devices: 0, pct: 0 })) },
  '/api/admin/engagement': { configured: true, days: 7, plays: 0, skips: 0, completes: 0, favorites: 0, downloads: 0, shares: 0, skipRate: 0, completionRate: 0, repeatRate: 0, avgPlaysPerUser: 0, retention: { d1: null, d7: null, d30: null }, totalUsers: 0 },
  '/api/admin/usage': { configured: true, days: 7, sampled: 0, source: 'exact', byType: [], byPlatform: [], heatmap: Array.from({ length: 7 }, () => Array(24).fill(0)), peak: null },
  '/api/admin/digest': { configured: true, digest: null, created_at: null },
  '/api/admin/location': { configured: true, days: 7, countries: [], cities: [], platforms: [] },
};

/** Every tab, with a phrase that proves real data rendered and the friendly empty-database message. */
const TABS: { path: string; full: RegExp; empty: RegExp }[] = [
  { path: 'live/now', full: /Active now[\s\S]*Naatu Naatu[\s\S]*Asha/, empty: /Nobody is listening right now/ },
  { path: 'live/activity', full: /Latest events[\s\S]*arijit/, empty: /No activity yet/ },
  { path: 'live/rooms', full: /ABCD12/, empty: /No Listen Together rooms right now/ },
  { path: 'live/pulse', full: /1\.8 s[\s\S]*Stream URL expired/, empty: /No recent errors/ },
  { path: 'listeners/all', full: /asha@example\.com[\s\S]*Account only/, empty: /No listeners yet/ },
  { path: 'listeners/top', full: /Most plays[\s\S]*Asha[\s\S]*@ravi/, empty: /No plays in this window/ },
  { path: 'audience/growth', full: /New devices · 14 days[\s\S]*24[\s\S]*Signed-in accounts[\s\S]*22/, empty: /No new devices yet/ },
  { path: 'audience/engagement', full: /Plays[\s\S]*1,200[\s\S]*58%/, empty: /No plays in the last 7 days yet/ },
  { path: 'audience/retention', full: /35%[\s\S]*43%/, empty: /No cohorts yet/ },
  { path: 'audience/funnel', full: /Opened the app[\s\S]*80%/, empty: /No one opened the app/ },
  { path: 'audience/segments', full: /New this week[\s\S]*12[\s\S]*Returning[\s\S]*30/, empty: /No listeners to group yet/ },
  { path: 'audience/usage', full: /By feature[\s\S]*Searches/, empty: /No events in this window/ },
  { path: 'audience/heatmap', full: /Busiest hour[\s\S]*Fri at 9 pm/, empty: /No listening in the last 7 days/ },
  { path: 'audience/insights', full: /Weekly digest[\s\S]*Naatu Naatu[\s\S]*Telugu/, empty: /No digest yet/ },
  { path: 'places/geo', full: /India[\s\S]*Hyderabad/, empty: /No locations in the last 7 days/ },
  { path: 'places/map', full: /World map[\s\S]*Listening now[\s\S]*Asha/, empty: /No listener locations in the last 7 days yet/ },
];

type Mode = 'full' | 'empty' | 'down';
interface Api { posts: { path: string; body: Record<string, unknown> }[]; gets: string[] }

async function mockApi(page: Page, mode: Mode, opts: { postStatus?: number; postBody?: unknown } = {}): Promise<Api> {
  const api: Api = { posts: [], gets: [] };
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await page.route('**/api/**', (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/api/admin/') && req.headers()['x-admin-token'] !== TOKEN) return send({ error: 'unauthorized' }, 401);
    if (req.method() === 'POST') {
      api.posts.push({ path: url.pathname, body: JSON.parse(req.postData() || '{}') as Record<string, unknown> });
      return send(opts.postBody ?? { ok: true }, opts.postStatus ?? 200);
    }
    api.gets.push(url.pathname + url.search);
    if (mode === 'down') return send({ configured: true, error: 'db_unavailable', upstreamStatus: 503 }, 502);
    const body = (mode === 'full' ? FULL : EMPTY)[url.pathname];
    return send(body ?? { configured: true });
  });
  await page.addInitScript((t) => {
    sessionStorage.setItem('vinax_admin_token', t);
    localStorage.setItem('vinax_admin_auto', '0');
  }, TOKEN);
  return api;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`/admin/#/${path}`);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#pageBody .state.loading, #pageBody .skeleton')).toHaveCount(0);
}

const bodyText = (page: Page): Promise<string> => page.locator('#pageBody').innerText();

function expectClean(text: string): void {
  expect(text).not.toMatch(/undefined|NaN|\[object Object\]|\bnull\b/);
}

test.describe('owner console · audience pages', () => {
  test('every tab renders with data', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'full');
    for (const tab of TABS) {
      await open(page, tab.path);
      await expect(page.locator('#pageBody')).toContainText(tab.full);
      expectClean(await bodyText(page));
    }
    expect(errors).toEqual([]);
  });

  test('a wiped database shows a friendly empty state on every tab', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'empty');
    for (const tab of TABS) {
      await open(page, tab.path);
      await expect(page.locator('#pageBody')).toContainText(tab.empty);
      const text = await bodyText(page);
      expectClean(text);
      expect(text).not.toContain('Could not load');
    }
    expect(errors).toEqual([]);
  });

  test('a database outage shows the reason and a retry on every tab', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'down');
    for (const tab of TABS) {
      await open(page, tab.path);
      await expect(page.locator('#pageBody')).toContainText('The database is not reachable right now.');
      await expect(page.getByRole('button', { name: 'Try again' }).first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('retention percentages are computed from the counts', async ({ page }) => {
    await mockApi(page, 'full');
    await open(page, 'audience/retention');
    const rows = page.locator('#pageBody tbody tr');
    // 42 of 120 → 35%, 30 of 120 → 25%, 6 of 120 → 5%.
    await expect(rows.nth(0)).toContainText(/35%[\s\S]*25%[\s\S]*5%/);
    // 38 of 88 → 43%, 19 of 88 → 22%, 11 of 88 → 13%.
    await expect(rows.nth(1)).toContainText(/43%[\s\S]*22%[\s\S]*13%/);
  });

  test('Listen Together: end one room and close all send the right actions', async ({ page }) => {
    const errors = watchErrors(page);
    const api = await mockApi(page, 'full');
    await open(page, 'live/rooms');

    await page.getByRole('button', { name: 'End room ABCD12' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End room' }).click();
    await expect.poll(() => api.posts.length).toBe(1);
    expect(api.posts[0]).toEqual({ path: '/api/admin/maintenance', body: { action: 'end_room', code: 'ABCD12' } });

    await page.getByRole('button', { name: 'Close all rooms' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Close all rooms' }).click();
    expect(api.posts.length).toBe(1); // typed confirmation still missing
    await dialog.getByRole('textbox').fill('CLOSE');
    await dialog.getByRole('button', { name: 'Close all rooms' }).click();
    await expect.poll(() => api.posts.length).toBe(2);
    expect(api.posts[1]).toEqual({ path: '/api/admin/maintenance', body: { action: 'close_rooms' } });
    expect(errors).toEqual([]);
  });

  test('Listeners: search, drawer, downloads and delete', async ({ page }) => {
    const errors = watchErrors(page);
    const api = await mockApi(page, 'full');
    await open(page, 'listeners/all');

    await page.getByRole('searchbox').fill('asha');
    await expect.poll(() => api.gets.some((g) => g.startsWith('/api/admin/users?') && g.includes('q=asha'))).toBe(true);
    await expect(page).toHaveURL(/q=asha/);

    await page.getByRole('radio', { name: 'Accounts only' }).click();
    await expect(page.locator('#pageBody tbody')).toContainText('kiran@example.com');
    await expect(page.locator('#pageBody tbody')).not.toContainText('asha@example.com');
    await page.getByRole('radio', { name: 'All' }).click();

    const [all] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download everyone' }).click()]);
    expect(all.suggestedFilename()).toMatch(/^vinax-listeners-asha-\d{4}-\d{2}-\d{2}\.csv$/);

    await page.getByText('asha@example.com').first().click();
    const drawer = page.locator('#drawer');
    await expect(drawer).toContainText('v13.7.4');
    await expect(drawer).toContainText('Top songs');
    await expect(drawer).toContainText('Telugu');
    expectClean(await drawer.innerText());

    for (const [label, name] of [['Report', /\.html$/], ['JSON', /\.json$/], ['Activity CSV', /-activity\.csv$/]] as const) {
      const [file] = await Promise.all([page.waitForEvent('download'), drawer.getByRole('button', { name: label, exact: true }).click()]);
      expect(file.suggestedFilename()).toMatch(name);
    }
    expect(api.gets.some((g) => g.startsWith('/api/admin/user?') && g.includes('full=1'))).toBe(true);

    // A reason is required before the confirm opens; then DELETE must be typed.
    await drawer.getByRole('button', { name: 'Delete listener' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
    await drawer.getByLabel('Reason').fill('asked to be removed');
    await drawer.getByRole('button', { name: 'Delete listener' }).click();
    const modal = page.locator('.modal');
    await modal.getByRole('textbox').fill('DELETE');
    await modal.getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => api.posts.length).toBe(1);
    expect(api.posts[0]).toEqual({ path: '/api/admin/maintenance', body: { action: 'delete_user', device_id: ASHA, reason: 'asked to be removed' } });
    await expect(drawer).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a delete the server rejects explains why', async ({ page }) => {
    await mockApi(page, 'full', { postStatus: 404, postBody: { ok: false, error: 'not_found' } });
    await open(page, `listeners/all?open=${ASHA}`);
    const drawer = page.locator('#drawer');
    await drawer.getByLabel('Reason').fill('test');
    await drawer.getByRole('button', { name: 'Delete listener' }).click();
    await page.locator('.modal').getByRole('textbox').fill('DELETE');
    await page.locator('.modal').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('#toasts')).toContainText('no longer exists');
  });

  test('Live rows open the listener drawer; the activity filter narrows the feed', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'full');
    await open(page, 'live/now');
    await page.locator('tr.clickable', { hasText: 'Asha' }).click();
    await expect(page.locator('#drawer')).toContainText('asha@example.com');
    await page.keyboard.press('Escape');

    await open(page, 'live/activity');
    await page.getByRole('radio', { name: 'Errors' }).click();
    await expect(page.locator('#pageBody tbody tr')).toHaveCount(1);
    await expect(page).toHaveURL(/type=error/);
    expect(errors).toEqual([]);
  });

  test('the world map draws cities and live listeners', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'full');
    await page.addInitScript(() => localStorage.removeItem('vinax_admin_geo2'));
    await open(page, 'places/map');
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.locator('.leaflet-overlay-pane path.leaflet-interactive')).toHaveCount(2);
    await expect(page.locator('.vx-live-marker')).toHaveCount(2);
    expect(errors).toEqual([]);
  });
});
