import { test, expect, type Page, type Route } from './support/test';

/**
 * 13.8 — owner console content pages (/admin/, static files, not the React
 * app): Music, Trends, Catalog and Home & promotion. Every tab renders with
 * realistic fixtures, with a freshly wiped (empty) database, and with a
 * database outage (the trends route answers 503 db_schema_missing, the rest
 * 502 db_unavailable); every write sends the body the server expects —
 * POST /api/admin/content (block / unblock), /api/admin/trends (run, review,
 * validate-import, import, withdraw) and /api/admin/appconfig for each config
 * key (value null clears it). Skip rates are computed from the raw counts.
 * All non-local network is aborted; zero page or console errors allowed.
 */

const TOKEN = 'owner-pass';
const iso = (hAgo: number): string => new Date(Date.now() - hAgo * 3_600_000).toISOString();
const day = (dAgo: number): string => new Date(Date.now() - dAgo * 86_400_000).toISOString().slice(0, 10);

function fullFixtures(): Record<string, unknown> {
  const song = (i: number) => ({ song_title: ['Kesariya', 'Naatu Naatu', 'Chaleya', 'Apna Bana Le', 'Hukum'][i % 5] + (i > 4 ? ' ' + i : ''), song_artist: ['Arijit Singh', 'Rahul Sipligunj', 'Anirudh', 'Sachin-Jigar', 'Anirudh'][i % 5], song_image: i % 2 ? 'https://c.saavncdn.com/x/' + i + '.jpg' : null, plays: 400 - i * 13 });
  return {
    '/api/admin/music': { configured: true, days: 7, topSongs: Array.from({ length: 25 }, (_, i) => song(i)), topArtists: [{ song_artist: 'Arijit Singh', plays: 900 }, { song_artist: 'Anirudh', plays: 610 }, { song_artist: 'Shreya Ghoshal', plays: 300 }], topLanguages: [{ language: 'hindi', plays: 1200 }, { language: 'telugu', plays: 800 }, { language: 'unknown', plays: 50 }], playsByDay: [0, 1, 2, 4, 5].map((d) => ({ day: day(d), plays: 300 + d * 40 })) },
    '/api/admin/insights': { configured: true, days: 7, segments: { new_7d: 3, returning_7d: 5, inactive_30d: 1, power_users: 1 }, playsByHour: [{ hour: 14, plays: 80 }, { hour: 15, plays: 120 }, { hour: 3, plays: 9 }], trending: [{ song_title: 'Hukum', song_artist: 'Anirudh', song_image: null, plays: 50, prev_plays: 10 }, { song_title: 'Chaleya', song_artist: 'Anirudh', song_image: null, plays: 20, prev_plays: 0 }], topListeners: [], languages: [] },
    '/api/admin/search-analytics': { configured: true, total: 420, top: [{ query: 'arijit', count: 40 }, { query: 'naatu naatu', count: 22 }], zero: [{ query: 'arr hitz', count: 7 }, { query: 'kesarya', count: 3 }], artists: [], languages: [] },
    '/api/admin/skips': { configured: true, days: 7, min: 5, sampled: 812, source: 'exact', items: [{ id: 'abc123', title: 'Loud Song', artist: 'Band', image: '', plays: 10, skips: 7, rate: 70 }, { id: 'def456', title: 'Rare Skip', artist: 'Solo', image: '', plays: 100, skips: 1, rate: 1 }, { id: 'ghi789', title: 'Over Skipped', artist: 'Odd', image: '', plays: 4, skips: 6, rate: 150 }] },
    '/api/admin/songstats': { configured: true, days: 30, q: 'kesariya', match: { id: 'abc123', title: 'Kesariya', artist: 'Arijit Singh', image: 'https://c.saavncdn.com/k.jpg', n: 120 }, candidates: [{ id: 'zz999', title: 'Kesariya (Remix)', artist: 'DJ', image: '', n: 4 }], totals: { plays: 120, skips: 30, completes: 80, favorites: 12, listeners: 44 }, byDay: [{ day: day(1), plays: 20, skips: 5 }, { day: day(3), plays: 40, skips: 9 }], countries: [{ country: 'IN', n: 100 }, { country: 'US', n: 20 }], platforms: [{ platform: 'android', n: 90 }, { platform: 'web', n: 30 }], skipRate: 25 },
    '/api/admin/trends': {
      configured: true, generatedAt: iso(0),
      providers: [
        { id: 'youtube', label: 'Public video chart', kind: 'public-chart', status: 'ok', reason: null, chart: 'music', derivedMetricsAllowed: true, dailyUnitBudget: 200, maxUnitsPerRun: 6 },
        { id: 'instagram', label: 'Short-video audio', kind: 'public-chart', status: 'disabled', reason: 'No public chart is available.', chart: '', derivedMetricsAllowed: false, dailyUnitBudget: null, maxUnitsPerRun: 0 },
        { id: 'editorial', label: 'Editor’s picks', kind: 'editorial', status: 'ok', reason: null, chart: '', derivedMetricsAllowed: false, dailyUnitBudget: null, maxUnitsPerRun: 0 }],
      policy: { staleAfterHours: 18, retentionDays: 28, operationalRetentionDays: 90, momentumMinWindowHours: 6, momentumMaxWindowHours: 48, matchBudgetPerRun: 20, autoMatchThreshold: 0.8, regions: ['IN'] },
      freshness: [{ source: 'youtube', region: 'IN', lastRunAt: iso(2), lastSuccessAt: iso(2), stale: false, lastError: { at: iso(30), error: 'quota', attempts: 2 }, latestSnapshot: { source: 'youtube', region: 'IN', chart: 'music', observed_at: iso(2), fetched_at: iso(2), item_count: 50 } }],
      quota: [{ source: 'youtube', usedToday: 120, dailyBudget: 200, maxUnitsPerRun: 6 }],
      retention: { oldestStoredAt: iso(24 * 20), oldestStoredDays: 20, limitDays: 28 },
      matches: { byStatus: { matched: 30, review: 2, accepted: 5, rejected: 1, corrected: 1 }, confidence: [{ range: '0–50%', count: 3 }, { range: '50–80%', count: 6 }, { range: '80–95%', count: 20 }, { range: '95–100%', count: 10 }], total: 39 },
      reviewQueue: [
        { id: 11, source: 'youtube', source_item_id: 'yt1', catalog_id: 'cat11', catalog_title: 'Hukum', catalog_artist: 'Anirudh', mapping_confidence: 0.62, method: 'fuzzy', status: 'review', reason: null, candidates: [{ id: 'cat11', title: 'Hukum', artist: 'Anirudh', album: 'Jailer', language: 'tamil', confidence: 0.62, method: 'fuzzy', reason: null, family: 'x' }, { id: 'cat12', title: 'Hukum (Telugu)', artist: 'Anirudh', album: null, language: 'telugu', confidence: 0.55, method: 'fuzzy', reason: null, family: 'x' }], reviewed_by: null, reviewed_at: null, history: [], first_seen_at: iso(10), last_seen_at: iso(2), observation: { source: 'youtube', source_item_id: 'yt1', title: 'Hukum - Official Video', credit: 'Sun TV', url: 'https://example.com/v/1', source_rank: 3, region: 'IN', observed_at: iso(2) } },
        { id: 12, source: 'youtube', source_item_id: 'yt2', catalog_id: null, catalog_title: null, catalog_artist: null, mapping_confidence: 0.2, method: 'none', status: 'review', reason: null, candidates: [], reviewed_by: null, reviewed_at: null, history: [], first_seen_at: iso(5), last_seen_at: iso(1), observation: null }],
      recentDecisions: [{ id: 9, source: 'youtube', source_item_id: 'yt9', catalog_id: 'c9', catalog_title: 'Chaleya', catalog_artist: 'Anirudh', mapping_confidence: 0.7, method: 'fuzzy', status: 'accepted', reason: null, candidates: [], reviewed_by: 'owner', reviewed_at: iso(4), history: [], first_seen_at: iso(30), last_seen_at: iso(5), observation: { source: 'youtube', source_item_id: 'yt9', title: 'Chaleya', credit: null, url: null, source_rank: 7, region: 'IN', observed_at: iso(5) } }],
      editorial: [
        { id: 5, title: 'Naatu Naatu', artist: 'Rahul Sipligunj', catalog_id: null, region: 'IN', language: 'telugu', position: 1, evidence_url: 'https://example.com/chart', note: null, starts_at: iso(48), expires_at: iso(-200), status: 'active', imported_by: 'owner', imported_at: iso(48), state: 'active' },
        { id: 6, title: 'Old pick', artist: 'X', catalog_id: null, region: 'IN', language: null, position: 2, evidence_url: 'javascript:alert(1)', note: null, starts_at: iso(900), expires_at: iso(100), status: 'active', imported_by: 'owner', imported_at: iso(900), state: 'expired' }],
      runs: [{ id: 'r1', source: 'youtube', region: 'IN', trigger: 'cron', started_at: iso(2), finished_at: iso(2), ok: true, status: 'ok', error: null, attempts: 1, items_fetched: 50, items_inserted: 50, matched: 40, queued_for_review: 2, quota_units: 6, duplicate_snapshot: false }, { id: 'r2', source: 'youtube', region: 'IN', trigger: 'cron', started_at: iso(30), finished_at: iso(30), ok: false, status: 'error', error: 'quota', attempts: 2, items_fetched: 0, items_inserted: 0, matched: 0, queued_for_review: 0, quota_units: 0, duplicate_snapshot: false }]
    },
    '/api/trending-searches': { queries: ['Kesariya', 'diwali songs', 'arijit'] },
    '/api/admin/content': { configured: true, blocked: [{ song_id: 'abc123', song_title: 'Loud Song', reason: 'complaint', created_at: iso(5) }, { song_id: 'artist:bad band', song_title: null, reason: null, created_at: iso(30) }, { song_id: 'kw:explicit', song_title: null, reason: 'policy', created_at: iso(60) }], topSongs: [{ song_id: 'abc123', song_title: 'Loud Song', song_artist: 'Band', plays: 90 }, { song_id: 'x1', song_title: 'Kesariya', song_artist: 'Arijit Singh', plays: 80 }] },
    '/api/admin/catalog-search': { items: [{ id: 'abc123', name: 'Loud Song', subtitle: 'Band, Other', image: 'https://c.saavncdn.com/a.jpg' }, { id: 'k1', name: 'Kesariya', subtitle: 'Arijit Singh', image: '' }], source: 'www.sirimillavinay.online', error: null },
    '/api/admin/seo': { configured: true, total: 1234, counts: [{ type: 'song', plural: 'songs', count: 1000, pages: 1 }, { type: 'album', plural: 'albums', count: 200, pages: 1 }, { type: 'artist', plural: 'artists', count: 30, pages: 1 }, { type: 'playlist', plural: 'playlists', count: 4, pages: 1 }], languages: [{ lang: 'hindi', n: 500 }, { lang: 'unknown', n: 20 }], addedByDay: [{ day: day(1), n: 40 }, { day: day(2), n: 12 }], newest: [{ key: 'song:abc123', type: 'song', name: 'Kesariya', slug: 'kesariya', lang: 'hindi', added_at: iso(3) }, { key: 'artist:77', type: 'artist', name: 'Arijit Singh', slug: 'arijit-singh', lang: '', added_at: iso(5) }], sampled: 1234, sitemap: { status: 200, ms: 120, entries: 6, bytes: 2048 } },
    '/api/cat/search/songs': { success: true, data: { results: [{ id: '1' }, { id: '2' }] } }
  };
}

function emptyFixtures(): Record<string, unknown> {
  return {
    '/api/admin/music': { configured: true, days: 7, topSongs: [], topArtists: [], topLanguages: [], playsByDay: [] },
    '/api/admin/insights': { configured: true, days: 7, segments: { new_7d: 0, returning_7d: 0, inactive_30d: 0, power_users: 0 }, playsByHour: [], trending: [], topListeners: [], languages: [] },
    '/api/admin/search-analytics': { configured: true, total: 0, top: [], zero: [], artists: [], languages: [] },
    '/api/admin/skips': { configured: true, days: 7, min: 5, sampled: 0, source: 'exact', items: [] },
    '/api/admin/songstats': { configured: true, days: 30, q: 'x', match: null, candidates: [], totals: { plays: 0, skips: 0, completes: 0, favorites: 0, listeners: 0 }, byDay: [], countries: [], platforms: [], skipRate: null },
    '/api/admin/trends': { configured: true, generatedAt: iso(0), providers: [{ id: 'youtube', label: 'Public video chart', kind: 'public-chart', status: 'not_configured', reason: 'YOUTUBE_API_KEY is not set.', chart: '', derivedMetricsAllowed: false, dailyUnitBudget: 200, maxUnitsPerRun: 6 }], policy: { staleAfterHours: 18, retentionDays: 28, autoMatchThreshold: 0.8, regions: ['IN'] }, freshness: [{ source: 'youtube', region: 'IN', lastRunAt: null, lastSuccessAt: null, stale: true, lastError: null, latestSnapshot: null }], quota: [{ source: 'youtube', usedToday: 0, dailyBudget: 200, maxUnitsPerRun: 6 }], retention: { oldestStoredAt: null, oldestStoredDays: null, limitDays: 28 }, matches: { byStatus: {}, confidence: [{ range: '0–50%', count: 0 }], total: 0 }, reviewQueue: [], recentDecisions: [], editorial: [], runs: [] },
    '/api/trending-searches': { queries: [] },
    '/api/admin/content': { configured: true, blocked: [], topSongs: [] },
    '/api/admin/catalog-search': { items: [], source: null, error: null },
    '/api/admin/seo': { configured: true, total: 0, counts: [{ type: 'song', plural: 'songs', count: 0, pages: 0 }], languages: [], addedByDay: [], newest: [], sampled: 0, sitemap: { status: 200, ms: 50, entries: 6, bytes: 900 } },
    '/api/cat/search/songs': { success: true, data: { results: [] } }
  };
}

const FULL_CFG = (): Record<string, unknown> => ({
  'trending-pins': ['Diwali songs', 'Kesariya'],
  banners: [{ id: 'b1', title: 'Diwali mixes', subtitle: 'Fresh every day', linkType: 'playlist', linkId: 'pl1', start: day(2), end: day(-5) }, { id: 'b2', title: 'Old offer', end: day(10) }, { id: 'b3', title: 'Coming soon', start: day(-3) }],
  festival: { mode: 'force', id: 'diwali' },
  greeting: { text: 'Festival week — new mixes', start: iso(5), end: iso(-48) },
  'home-layout': { title: 'Hello', description: 'Desc', order: ['charts', 'quick'], hidden: ['feed'] },
  'support-faq': [{ q: 'How do I download?', a: 'Use the Android app.' }],
  broadcast: { id: 'b1', text: 'Listen Together is here', link: '/together' },
  'search-synonyms': { arr: 'A. R. Rahman' },
  'catalog-sources': { 'vinax-render': false },
  'language-order': ['telugu', 'hindi'],
});

const TABS: { path: string; full: RegExp; empty: RegExp }[] = [
  { path: 'music/top', full: /Plays per day[\s\S]*Top artists[\s\S]*Arijit Singh[\s\S]*Top songs[\s\S]*Kesariya[\s\S]*When people listen[\s\S]*Rising songs[\s\S]*Hukum/, empty: /No plays in the last 7 days yet/ },
  { path: 'music/search', full: /Top searches[\s\S]*arijit[\s\S]*found nothing[\s\S]*arr hitz/, empty: /No searches in the last 7 days yet[\s\S]*Every search found something/ },
  { path: 'music/skips', full: /Most skipped songs[\s\S]*Loud Song/, empty: /No song has 5 plays yet/ },
  { path: 'music/song?q=kesariya', full: /Kesariya[\s\S]*Listeners[\s\S]*44[\s\S]*Other matches[\s\S]*Kesariya \(Remix\)/, empty: /No plays match “kesariya”/ },
  { path: 'trends/sources', full: /Sources running[\s\S]*2 of 3[\s\S]*Public video chart[\s\S]*Fresh[\s\S]*Run history/, empty: /Not configured[\s\S]*YOUTUBE_API_KEY is not set[\s\S]*No runs yet/ },
  { path: 'trends/review', full: /Hukum - Official Video[\s\S]*62% sure[\s\S]*Recent decisions[\s\S]*Chaleya/, empty: /The queue is empty[\s\S]*No decisions yet/ },
  { path: 'trends/editorial', full: /Import editorial picks[\s\S]*Naatu Naatu[\s\S]*Active/, empty: /No editorial picks yet/ },
  { path: 'trends/pins', full: /Pinned searches[\s\S]*What listeners see now[\s\S]*arijit/, empty: /No trending chips yet/ },
  { path: 'catalog/blocked', full: /Songs blocked[\s\S]*Loud Song[\s\S]*bad band[\s\S]*explicit[\s\S]*Most played songs/, empty: /Nothing is blocked[\s\S]*No plays in the last 30 days/ },
  { path: 'catalog/lookup?q=loud', full: /2 results for “loud”[\s\S]*Loud Song[\s\S]*Song blocked/, empty: /Nothing found for “loud”/ },
  { path: 'catalog/synonyms', full: /Search synonyms[\s\S]*1 of 200/, empty: /Not set — the app uses its built-in default/ },
  { path: 'catalog/sources', full: /VinaX Music API[\s\S]*Off/, empty: /Backup catalogue mirror[\s\S]*On/ },
  { path: 'catalog/languages', full: /Telugu[\s\S]*Hindi[\s\S]*Tamil/, empty: /Hindi[\s\S]*Telugu[\s\S]*Tamil/ },
  { path: 'catalog/io', full: /3 blocked entries/, empty: /Nothing is blocked yet/ },
  { path: 'catalog/seo', full: /Public pages[\s\S]*1,234[\s\S]*Reachable[\s\S]*Newest pages[\s\S]*Kesariya/, empty: /No public pages are known yet/ },
  { path: 'home/banners', full: /Published banners[\s\S]*Diwali mixes[\s\S]*Live now[\s\S]*Old offer[\s\S]*Ended[\s\S]*Coming soon[\s\S]*Scheduled/, empty: /No banners published/ },
  { path: 'home/festival', full: /Now showing[\s\S]*Forced/, empty: /Now showing[\s\S]*Follow calendar/ },
  { path: 'home/greeting', full: /Published “Festival week — new mixes”[\s\S]*Live now/, empty: /Nothing published — the app uses its default/ },
  { path: 'home/layout', full: /Shelves, top first[\s\S]*Charts[\s\S]*Turned off for everyone: More to explore/, empty: /Quick picks[\s\S]*Made for you/ },
  { path: 'home/faq', full: /How do I download\?/, empty: /No FAQ — the app uses its default/ },
  { path: 'home/announce', full: /Listen Together is here[\s\S]*Live now/, empty: /Nothing published — the app uses its default/ },
];

type Mode = 'full' | 'empty' | 'down';
interface Post { path: string; body: Record<string, unknown> }
interface Api { posts: Post[]; cfg: Record<string, unknown> }

async function mockApi(page: Page, mode: Mode): Promise<Api> {
  const fx = mode === 'full' ? fullFixtures() : emptyFixtures();
  const api: Api = { posts: [], cfg: mode === 'full' ? FULL_CFG() : {} };
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await page.route('**/api/**', (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p.startsWith('/api/admin/') && req.headers()['x-admin-token'] !== TOKEN) return send({ error: 'unauthorized' }, 401);
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}') as Record<string, unknown>;
      api.posts.push({ path: p, body });
      if (p === '/api/admin/appconfig') {
        if (body.value === null) delete api.cfg[String(body.key)];
        else api.cfg[String(body.key)] = body.value;
        return send({ ok: true });
      }
      if (p === '/api/admin/content' && body.kind === 'keyword' && String(body.songId).length < 3) return send({ error: 'keyword_too_short' }, 400);
      if (p === '/api/admin/trends') {
        if (body.action === 'run') return send({ ok: true, runs: [{ source: 'youtube', region: 'IN', status: 'ok', reason: null, attempts: 1, fetched: 50, inserted: 50, duplicateSnapshot: false, matched: 40, review: 2, deferred: 0, quotaUnits: 6, snapshotKey: 'k' }], notRun: [{ source: 'instagram', status: 'disabled', reason: 'No public chart.' }], pruned: null });
        if (body.action === 'validate-import') return send({ ok: false, rows: 2, valid: 1, issues: [{ row: 2, field: 'evidence_url', message: 'must be https' }], preview: [] });
        if (body.action === 'import') return send({ ok: true, inserted: 2, alreadyImported: 1, refresh: [] });
        return send({ ok: true, status: 'accepted', catalogId: 'cat11' });
      }
      return send({ ok: true });
    }
    if (mode === 'down') {
      return p === '/api/admin/trends'
        ? send({ configured: true, error: 'db_schema_missing', providers: [], policy: {} }, 503)
        : send({ configured: true, error: 'db_unavailable', upstreamStatus: 503 }, 502);
    }
    if (p === '/api/admin/appconfig') {
      const k = url.searchParams.get('key') ?? '';
      return send({ configured: true, value: api.cfg[k] ?? null, updated_at: api.cfg[k] != null ? iso(3) : null });
    }
    return send(fx[p] ?? { configured: true });
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
const lastPost = (api: Api): Post | undefined => api.posts[api.posts.length - 1];
const row = (page: Page, text: string) => page.locator('#pageBody tr', { hasText: text });
async function confirm(page: Page, label: string): Promise<void> {
  await page.locator('.modal-foot button', { hasText: label }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
}
async function expectPost(api: Api, path: string, body: Record<string, unknown>): Promise<void> {
  await expect.poll(() => lastPost(api)).toEqual({ path, body });
}

function expectClean(text: string): void {
  expect(text).not.toMatch(/undefined|NaN|\[object Object\]|\bnull\b/);
}

test.describe('owner console · content pages', () => {
  test('every tab renders with data', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'full');
    for (const tab of TABS) {
      await open(page, tab.path);
      await expect(page.locator('#pageBody'), tab.path).toContainText(tab.full);
      expectClean(await bodyText(page));
    }
    expect(errors).toEqual([]);
  });

  test('a wiped database shows a friendly empty state on every tab', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'empty');
    for (const tab of TABS) {
      await open(page, tab.path);
      await expect(page.locator('#pageBody'), tab.path).toContainText(tab.empty);
      const text = await bodyText(page);
      expectClean(text);
      expect(text, tab.path).not.toContain('Could not load');
    }
    expect(errors).toEqual([]);
  });

  test('a database outage shows the reason and a retry on every tab', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'down');
    for (const tab of TABS) {
      if (tab.path === 'catalog/lookup?q=loud') continue; // the lookup does not use the database
      await open(page, tab.path);
      await expect(page.locator('#pageBody'), tab.path).toContainText(tab.path.startsWith('trends/') && tab.path !== 'trends/pins' ? 'A database table or function is missing' : 'The database is not reachable right now.');
      await expect(page.getByRole('button', { name: 'Try again' }).first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('skip rates are skips ÷ plays from the raw counts, capped at 100%', async ({ page }) => {
    await mockApi(page, 'full');
    await open(page, 'music/skips');
    const rate = (song: string) => row(page, song).locator('td').nth(3); // Song · Plays · Skips · Skip rate
    await expect(rate('Loud Song')).toHaveText('70%');
    await expect(rate('Rare Skip')).toHaveText('1%'); // the old console showed 100% here
    await expect(rate('Over Skipped')).toHaveText('100%');
    // 14 skips over 114 plays across the listed songs.
    await expect(page.locator('.kpi', { hasText: 'Skip rate' })).toContainText('12%');
  });

  test('Music and Trends writes send the right bodies', async ({ page }) => {
    const errors = watchErrors(page);
    const api = await mockApi(page, 'full');

    await open(page, 'music/skips');
    await row(page, 'Loud Song').getByRole('button', { name: 'Block', exact: true }).click();
    await confirm(page, 'Block song');
    await expectPost(api, '/api/admin/content', { action: 'block', kind: 'song', songId: 'abc123', songTitle: 'Loud Song', reason: 'Skipped 70% of plays' });

    await open(page, 'music/search');
    await row(page, 'arr hitz').getByRole('button', { name: 'Add synonym' }).click();
    await expect(page.locator('.editor-row input').first()).toHaveValue('arr hitz');
    await page.locator('.editor-row input').nth(1).fill('A. R. Rahman hits');
    await page.getByRole('button', { name: 'Publish synonyms' }).click();
    await expectPost(api, '/api/admin/appconfig', { key: 'search-synonyms', value: { 'arr hitz': 'A. R. Rahman hits', arr: 'A. R. Rahman' } });

    await open(page, 'trends/sources');
    await page.getByRole('button', { name: 'Run all now' }).click();
    await expectPost(api, '/api/admin/trends', { action: 'run' });
    await expect(page.locator('.modal')).toContainText(/Did not run[\s\S]*instagram/);
    await page.locator('.modal-foot button', { hasText: 'Close' }).click();
    await page.getByRole('button', { name: 'Run youtube IN' }).click();
    await expectPost(api, '/api/admin/trends', { action: 'run', source: 'youtube', region: 'IN' });
    await page.locator('.modal-foot button', { hasText: 'Close' }).click();

    await open(page, 'trends/review');
    await expect(row(page, 'yt2').getByRole('button', { name: 'Accept' })).toBeDisabled();
    await row(page, 'Hukum - Official Video').getByRole('button', { name: 'Accept' }).click();
    await expectPost(api, '/api/admin/trends', { action: 'review', id: 11, decision: 'accept' });
    await open(page, 'trends/review');
    await row(page, 'Hukum - Official Video').getByRole('button', { name: 'Correct' }).click();
    await page.locator('.modal li', { hasText: 'Hukum (Telugu)' }).getByRole('button', { name: 'Use' }).click();
    await confirm(page, 'Save correction');
    await expectPost(api, '/api/admin/trends', { action: 'review', id: 11, decision: 'correct', catalogId: 'cat12' });

    await open(page, 'trends/editorial');
    const csv = 'title,artist,evidence_url,expires_at\nSong A,Artist,https://x.example/a,2026-11-01';
    await page.getByLabel('Editorial picks to import').fill(csv);
    await page.getByRole('button', { name: 'Check file' }).click();
    await expectPost(api, '/api/admin/trends', { action: 'validate-import', format: 'csv', data: csv });
    await expect(page.locator('#pageBody')).toContainText('must be https');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expectPost(api, '/api/admin/trends', { action: 'import', format: 'csv', data: csv });
    await open(page, 'trends/editorial');
    await row(page, 'Naatu Naatu').getByRole('button', { name: 'Withdraw' }).click();
    await confirm(page, 'Withdraw');
    await expectPost(api, '/api/admin/trends', { action: 'withdraw', editorialId: 5 });

    await open(page, 'trends/pins');
    await page.getByLabel('Pin 3').fill('  Navratri garba ');
    await page.getByLabel('Pin 4').fill('kesariya'); // duplicate of pin 2, dropped
    await page.getByLabel('Pin 5').fill('x'); // too short, dropped
    await page.getByRole('button', { name: 'Publish pins' }).click();
    await expectPost(api, '/api/admin/appconfig', { key: 'trending-pins', value: ['Diwali songs', 'Kesariya', 'Navratri garba'] });
    await open(page, 'trends/pins');
    await page.getByRole('button', { name: 'Clear pins' }).click();
    await confirm(page, 'Clear pins');
    await expectPost(api, '/api/admin/appconfig', { key: 'trending-pins', value: null });
    expect(errors).toEqual([]);
  });

  test('Catalog writes send the right bodies', async ({ page }) => {
    const errors = watchErrors(page);
    const api = await mockApi(page, 'full');

    await open(page, 'catalog/blocked');
    await page.getByRole('radio', { name: 'Word' }).click();
    await page.getByLabel('Word or phrase').fill('ab');
    await page.getByRole('button', { name: 'Block', exact: true }).first().click();
    expect(api.posts).toHaveLength(0); // refused before it reaches the server
    await page.getByLabel('Word or phrase').fill('remix');
    await page.getByLabel('Reason').fill('policy');
    await page.getByRole('button', { name: 'Block', exact: true }).first().click();
    await confirm(page, 'Block');
    await expectPost(api, '/api/admin/content', { action: 'block', kind: 'keyword', songId: 'remix', reason: 'policy' });
    await open(page, 'catalog/blocked');
    await row(page, 'bad band').getByRole('button', { name: 'Unblock' }).click();
    await expectPost(api, '/api/admin/content', { action: 'unblock', songId: 'artist:bad band' });

    await open(page, 'catalog/lookup?q=loud');
    await row(page, 'Kesariya').getByRole('button', { name: 'Block song' }).click();
    await confirm(page, 'Block');
    await expectPost(api, '/api/admin/content', { action: 'block', kind: 'song', songId: 'k1', songTitle: 'Kesariya', reason: 'Blocked from catalogue lookup' });
    await row(page, 'Loud Song').getByRole('button', { name: 'Block artist…' }).click();
    await expect(page.locator('.modal input')).toHaveValue('Band');
    await confirm(page, 'Block artist');
    await expectPost(api, '/api/admin/content', { action: 'block', kind: 'artist', songId: 'Band', reason: 'Blocked from catalogue lookup' });

    await open(page, 'catalog/sources');
    await page.getByLabel('VinaX Music API').check({ force: true });
    await page.getByLabel('Backup catalogue mirror').uncheck({ force: true });
    await page.getByRole('button', { name: 'Publish switches' }).click();
    await expectPost(api, '/api/admin/appconfig', { key: 'catalog-sources', value: { 'vinax-render': true, 'local-catalog': true, sirimilla: false } });

    await open(page, 'catalog/languages');
    await page.getByRole('button', { name: 'Move tamil up' }).click();
    await page.getByRole('button', { name: 'Publish order' }).click();
    await expect.poll(() => (lastPost(api)?.body.value as string[] | undefined)?.slice(0, 3)).toEqual(['telugu', 'tamil', 'hindi']);
    await page.getByRole('button', { name: 'Back to default' }).click();
    await confirm(page, 'Back to default');
    await expectPost(api, '/api/admin/appconfig', { key: 'language-order', value: null });

    await open(page, 'catalog/io');
    await page.getByLabel('Choose a blocklist JSON file').setInputFiles({
      name: 'blocklist.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([{ songId: 'abc123', title: 'Loud Song' }, { songId: 'new1', title: 'New one', reason: 'old reason' }, { songId: 'kw:bad' }])),
    });
    const before = api.posts.length;
    await page.getByRole('button', { name: /Import 2 new blocks/ }).click();
    await confirm(page, 'Import');
    await expect.poll(() => api.posts.slice(before).map((p) => p.body)).toEqual([
      { action: 'block', songId: 'new1', reason: 'old reason', songTitle: 'New one' },
      { action: 'block', songId: 'kw:bad', reason: 'Imported from file' },
    ]);
    expect(errors).toEqual([]);
  });

  test('Home & promotion writes send the right bodies', async ({ page }) => {
    const errors = watchErrors(page);
    const api = await mockApi(page, 'full');

    await open(page, 'home/banners');
    await page.getByLabel('Title', { exact: true }).fill('Navratri nights');
    await page.getByLabel('Opens').selectOption('song');
    await page.getByLabel('Link id').fill('s99');
    await page.getByRole('button', { name: 'Publish banner' }).click();
    await expect.poll(() => {
      const p = lastPost(api);
      const v = p?.body.value as Record<string, unknown>[] | undefined;
      return p?.body.key === 'banners' && v ? { n: v.length, title: v[0].title, linkType: v[0].linkType, linkId: v[0].linkId, keep: v[1].id } : null;
    }).toEqual({ n: 4, title: 'Navratri nights', linkType: 'song', linkId: 's99', keep: 'b1' });
    await open(page, 'home/banners');
    await row(page, 'Navratri nights').getByRole('button', { name: 'Delete' }).click();
    await confirm(page, 'Delete');
    await expect.poll(() => (lastPost(api)?.body.value as { title: string }[]).map((b) => b.title)).toEqual(['Diwali mixes', 'Old offer', 'Coming soon']);
    await open(page, 'home/banners');
    await page.getByRole('button', { name: 'Remove all banners' }).click();
    await confirm(page, 'Remove all banners');
    await expectPost(api, '/api/admin/appconfig', { key: 'banners', value: null });

    await open(page, 'home/festival');
    await page.getByRole('radio', { name: 'Off for everyone' }).click();
    await expectPost(api, '/api/admin/appconfig', { key: 'festival', value: { mode: 'off' } });
    await open(page, 'home/festival');
    await page.locator('section.card', { hasText: 'Halloween' }).getByRole('button', { name: 'Force now' }).click();
    await confirm(page, 'Force theme');
    await expectPost(api, '/api/admin/appconfig', { key: 'festival', value: { mode: 'force', id: 'halloween' } });
    await open(page, 'home/festival');
    await page.getByRole('button', { name: 'Back to calendar' }).click();
    await expectPost(api, '/api/admin/appconfig', { key: 'festival', value: { mode: 'auto' } });

    await open(page, 'home/greeting');
    await page.getByLabel('Line').fill('Happy Dussehra!');
    await page.getByLabel('Show from (optional)').fill('');
    await page.getByLabel('Show until (optional)').fill('');
    await page.getByRole('button', { name: 'Publish greeting' }).click();
    await expectPost(api, '/api/admin/appconfig', { key: 'greeting', value: { text: 'Happy Dussehra!' } });
    await open(page, 'home/greeting');
    await page.getByRole('button', { name: 'Clear greeting' }).click();
    await confirm(page, 'Clear greeting');
    await expectPost(api, '/api/admin/appconfig', { key: 'greeting', value: null });

    await open(page, 'home/layout');
    await page.getByRole('button', { name: 'Move Quick picks up' }).click();
    await page.getByLabel('Show Moods').uncheck({ force: true });
    await page.getByRole('button', { name: 'Publish layout' }).click();
    await expect.poll(() => {
      const v = lastPost(api)?.body.value as { order: string[]; hidden: string[]; title: string } | undefined;
      return v && v.order ? { first: v.order[0], n: v.order.length, hidden: v.hidden, title: v.title } : null;
    }).toEqual({ first: 'quick', n: 13, hidden: ['moods', 'feed'], title: 'Hello' });

    await open(page, 'home/faq');
    await page.getByRole('button', { name: 'Add a question' }).click();
    await page.getByRole('textbox', { name: 'Question 2' }).fill('Is it free?');
    await page.getByRole('textbox', { name: 'Answer 2' }).fill('Yes.');
    await page.getByRole('button', { name: 'Publish FAQ' }).click();
    await expectPost(api, '/api/admin/appconfig', { key: 'support-faq', value: [{ q: 'How do I download?', a: 'Use the Android app.' }, { q: 'Is it free?', a: 'Yes.' }] });

    await open(page, 'home/announce');
    const n = api.posts.length;
    await page.getByLabel('Opens (optional)').fill('https://elsewhere.example');
    await page.getByRole('button', { name: 'Publish announcement' }).click();
    expect(api.posts).toHaveLength(n); // links must stay inside the app
    await page.getByLabel('Opens (optional)').fill('/together');
    await page.getByRole('button', { name: 'Publish announcement' }).click();
    await expectPost(api, '/api/admin/appconfig', { key: 'broadcast', value: { id: 'b1', text: 'Listen Together is here', link: '/together' } });
    await open(page, 'home/announce');
    await page.getByRole('button', { name: 'Stop showing' }).click();
    await confirm(page, 'Stop showing');
    await expectPost(api, '/api/admin/appconfig', { key: 'broadcast', value: null });
    expect(errors).toEqual([]);
  });
});
