import { test, expect, type Page } from './support/test';

/**
 * 14.0 — owner console pages (/admin/, static files) against a mocked
 * Worker that answers the admin API contract in docs/database.md: Overview,
 * Live, Listeners, Analytics, Feedback, Experiments, VinaX AI, Catalog,
 * Publish, Notifications, Database and Health.
 *
 * Every tab renders with realistic answers, with empty answers and with the
 * server failing (inline error with retry); the AI lab sends the exact body
 * the server expects; the push composer previews before it sends. All
 * non-localhost network is aborted; zero page or console errors allowed; no
 * "undefined" / "NaN" / "null" on screen.
 */

const iso = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const day = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const SSE = ['{"meta":{"model":"meta/llama-3.3-70b-instruct","name":"Llama 3.3 70B","provider":"nvidia","lane":"chat"}}', '{"delta":"Hello from the lab."}', '{"done":true,"chars":19}']
  .map((l) => `data: ${l}\n\n`).join('');

const TABS = [
  'overview',
  'live/now', 'live/activity', 'live/rooms',
  'listeners',
  'analytics/music', 'analytics/places', 'analytics/engagement', 'analytics/retention', 'analytics/funnel', 'analytics/skips',
  'feedback', 'feedback?status=all',
  'experiments',
  'ai/usage', 'ai/lab', 'ai/probe',
  'catalog/lookup?q=kesariya', 'catalog/blocked',
  'publish', 'publish?key=site-mode',
  'notify/send', 'notify/history', 'notify/audience', 'notify/setup',
  'database/tables', 'database/jobs', 'database/audit', 'database/maintenance',
  'health/status', 'health/errors', 'health/edge', 'health/releases', 'health/env',
  'seo/overview', 'seo/audit', 'seo/tools',
];
/** Tabs that only call the server when a button is pressed. */
const ON_DEMAND = new Set(['ai/lab', 'ai/probe', 'seo/tools']);

type Json = Record<string, unknown>;

const timeline = (full: boolean) => (full ? [0, 1, 2, 3, 4, 5, 6].reverse().map((d) => ({ day: day(d), plays: 100 + d * 7, listeners: 20 + d, newListeners: d % 3, errors: d === 2 ? 3 : 0, searches: 40 + d })) : []);
const song = { id: 'k1', title: 'Kesariya', artist: 'Arijit Singh', image: '' };

function fixtures(full: boolean): Record<string, Json> {
  return {
    '/api/admin/overview': full
      ? { configured: true, schema: { version: 1, appliedAt: iso(50) }, kpis: { activeNow: 3, listeners: 120, newListeners24h: 4, accounts: 30, newAccounts7d: 5, plays24h: 400, plays7d: 2600, errors24h: 1, dau: 40, wau: 90, mau: 110, feedbackNew: 2, pushDevices: 55, roomsActive: 1, aiCalls24h: 12 }, timeline: timeline(true), platforms: [{ platform: 'android', listeners: 80, accounts: 20 }, { platform: 'web', listeners: 40, accounts: 10 }], attention: [{ level: 'warn', text: '2 new feedback messages', page: 'feedback' }] }
      : { configured: true, kpis: {}, timeline: [], platforms: [], attention: [] },
    '/api/admin/live': full
      ? { configured: true, now: iso(0), listening: [{ id: 'd_1', name: 'Asha', handle: 'asha', platform: 'android', country: 'IN', city: 'Hyderabad', song: { title: 'Kesariya', artist: 'Arijit Singh', image: '' }, isPlaying: true, lastSeen: iso(0) }], feed: [{ at: iso(0), kind: 'play', listener: { id: 'd_1', name: 'Asha' }, song: { title: 'Kesariya', artist: 'Arijit Singh' }, platform: 'android', country: 'IN' }, { at: iso(0.1), kind: 'error', listener: { id: 'd_2' }, message: 'audio decode failed', platform: 'web', country: 'IN' }], rooms: [{ code: 'ABC234', hostName: 'Asha', members: 3, song: { title: 'Kesariya', artist: 'Arijit Singh' }, playing: true, updatedAt: iso(0), createdAt: iso(1) }] }
      : { configured: true, now: iso(0), listening: [], feed: [], rooms: [] },
    '/api/admin/listeners': full
      ? { configured: true, total: 2, counts: { listeners: 120, accounts: 30, byPlatform: { android: 80, web: 40, ios: 0 } }, rows: [
        { listenerId: 'd_1', accountId: 'g1', name: 'Asha Rao', handle: 'asha', email: 'asha@example.com', picture: null, platform: 'android', appVersion: '14.0.0', country: 'IN', region: 'Telangana', city: 'Hyderabad', nowPlaying: { title: 'Kesariya' }, isPlaying: true, firstSeen: iso(400), lastSeen: iso(0) },
        { listenerId: 'd_2', accountId: null, name: null, handle: 'ravi_22', email: null, picture: null, platform: 'web', appVersion: '14.0.0', country: 'IN', region: null, city: 'Chennai', nowPlaying: null, isPlaying: false, firstSeen: iso(40), lastSeen: iso(5) },
      ] }
      : { configured: true, total: 0, counts: {}, rows: [] },
    '/api/admin/feedback': full
      ? { configured: true, total: 2, counts: { new: 2, read: 1, resolved: 4 }, rows: [{ id: 1, at: iso(2), listenerId: 'd_1', name: 'Asha', kind: 'bug', message: 'The lyrics stop scrolling', platform: 'android', appVersion: '14.0.0', country: 'IN', city: 'Hyderabad', status: 'new' }, { id: 2, at: iso(5), name: null, kind: 'idea', message: 'Sleep timer please', platform: 'web', status: 'new' }] }
      : { configured: true, total: 0, counts: {}, rows: [] },
    '/api/admin/experiments': full
      ? { configured: true, rows: [{ key: 'home-shelf-order', name: 'Shelf order', variants: [{ name: 'control', pct: 50 }, { name: 'charts-first', pct: 50 }], active: true, createdAt: iso(100), updatedAt: iso(10) }] }
      : { configured: true, rows: [] },
    '/api/admin/ai': full
      ? { configured: true, days: 7, summary: { total: 120, ok: 110, fail: 10, p50: 900, p95: 3200, promptTokens: 40000, completionTokens: 12000 }, byFeature: [{ feature: 'chat', total: 80, ok: 75, fail: 5, p50: 800, p95: 3000 }], byProvider: [{ provider: 'nvidia', total: 100, ok: 92, fail: 8 }], byModel: [{ model: 'meta/llama-3.3-70b-instruct', provider: 'nvidia', calls: 100, fail: 8, promptTokens: 30000, completionTokens: 9000 }], byDay: timeline(true).map((t) => ({ day: t.day, total: t.plays, ok: t.plays - 3, fail: 3 })), errors: [{ error: 'timeout', count: 6 }], recent: [{ at: iso(0), feature: 'chat', lane: 'chat', provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct', ok: true, status: 200, client: 'web', latencyMs: 850 }] }
      : { configured: true, days: 7, summary: {}, byFeature: [], byProvider: [], byModel: [], byDay: [], errors: [], recent: [] },
    '/api/admin/content': full
      ? { configured: true, blocked: [{ id: 1, kind: 'song', value: 'x9', label: 'Bad Song', reason: 'copyright', createdAt: iso(30) }], suggestions: [{ ...song, plays: 320 }] }
      : { configured: true, blocked: [], suggestions: [] },
    '/api/admin/settings': full
      ? { configured: true, keys: [
        { key: 'banners', group: 'Home & promotion', title: 'Banners & offers', note: 'Cards on Home.', shape: 'array' },
        { key: 'greeting', group: 'Home & promotion', title: 'Home greeting', note: 'A line under the Home title.', shape: 'object' },
        { key: 'flags', group: 'App', title: 'Feature switches', note: 'Boolean flags.', shape: 'boolean-map' },
        { key: 'site-mode', group: 'Operations', title: 'Site mode', note: 'live or maintenance.', shape: 'object' },
        { key: 'retention', group: 'Operations', title: 'Data retention', note: '{ eventsDays }.', shape: 'object' },
        { key: 'ai-rules', group: 'VinaX AI', title: 'House rules', note: 'Plain text.', shape: 'string' },
        { key: 'search-synonyms', group: 'Catalog', title: 'Search synonyms', note: 'Pairs.', shape: 'object' },
      ], values: { greeting: { text: 'Good evening' }, flags: { aiHome: true, codeRun: false } }, updated: { greeting: { at: iso(3), by: 'owner' }, flags: { at: iso(30), by: 'owner' } } }
      : { configured: true, keys: [{ key: 'greeting', group: 'Home & promotion', title: 'Home greeting', note: 'A line under the Home title.', shape: 'object' }], values: {}, updated: {} },
    '/api/admin/push': full
      ? { configured: true, web: { configured: true, active: 40 }, fcm: { configured: true, active: 15 }, geo: { countries: [{ key: 'IN', count: 50 }], regions: [{ key: 'Telangana', count: 20, country: 'IN' }], cities: [{ key: 'Hyderabad', count: 15, region: 'Telangana', country: 'IN' }] }, langs: [{ lang: 'te', count: 30 }, { lang: 'en-IN', count: 25 }], rules: { minGapHours: 20 } }
      : { configured: true, web: { configured: false, active: 0 }, fcm: { configured: false, active: 0 }, geo: {}, langs: [], rules: {} },
    '/api/admin/notifications': full
      ? { configured: true, rows: [{ id: 7, at: iso(20), kind: 'announcement', title: 'Diwali playlist', body: 'Fresh picks for the festival', link: '/playlist/d1', audience: {}, web: { total: 40, sent: 38, gone: 2 }, fcm: { total: 15, sent: 15 }, failures: null, retractedAt: null }] }
      : { configured: true, rows: [] },
    '/api/admin/audit': full
      ? { configured: true, rows: [{ id: 1, at: iso(1), actor: 'owner', action: 'settings', target: 'greeting', summary: 'greeting published', before: null, after: { text: 'Good evening' }, requestId: 'ray1' }] }
      : { configured: true, rows: [] },
    '/api/admin/database': full
      ? { configured: true, reachable: true, schema: { version: 1, appliedAt: iso(50) }, tables: [{ name: 'events', rows: 120000, bytes: 52_000_000 }, { name: 'listeners', rows: 120, bytes: 80_000 }], counts: { listeners: 120, events: 120000 }, jobs: [{ job: 'status-tick', schedule: 'every 30 min', lastAt: iso(0.2), ok: true, summary: { probes: 3 }, overdue: false }, { job: 'housekeeping', schedule: 'hourly', lastAt: iso(5), ok: false, summary: null, overdue: true }], retention: { eventsDays: 180 }, missing: [] }
      : { configured: true, reachable: true, schema: null, tables: [], counts: {}, jobs: [], retention: {}, missing: [] },
    '/api/admin/health': {
      time: iso(0),
      ai: full
        ? [
          { key: 'NVIDIA · dj, chat', provider: 'nvidia', env: 'NVIDIA_API_KEY', envInUse: 'NVIDIA_API_KEY', lanes: ['dj', 'chat'], media: [], tools: [], configured: true, ok: true, status: 200, model: 'meta/llama-3.3-70b-instruct', note: null },
          { key: 'Groq · mini', provider: 'groq', env: 'GROQ_API_KEY', envInUse: null, lanes: ['mini'], media: [], tools: [], configured: false, ok: false, status: null, model: null, note: 'not configured' },
        ]
        : [],
      lanes: full ? [{ lane: 'dj', provider: 'nvidia', keySet: true }, { lane: 'mini', provider: 'groq', keySet: false }] : [],
    },
    '/api/admin/seo': {
      origin: 'https://www.example.test', checkedAt: iso(0), indexable: full ? 1240 : 0, issues: full ? 2 : 0,
      robots: { status: 200, sitemaps: full ? ['https://www.example.test/sitemap.xml'] : [], blockedAgents: full ? ['GPTBot', 'CCBot'] : [], disallowAll: false },
      sitemap: { status: 200, maps: full ? 3 : 0, lastmod: full ? day(0) : null },
      maps: full ? [{ path: '/sitemap-static.xml', status: 200, urls: 31, lastmod: day(0), sample: ['/'] }, { path: '/sitemap-hubs.xml', status: 200, urls: 72, lastmod: day(0), sample: ['/telugu-romantic-songs'] }, { path: '/entity-pages.xml', status: 200, urls: 1137, lastmod: day(0), sample: ['/song/kesariya-k1'] }] : [],
      pages: full ? [
        { path: '/', status: 200, ms: 120, title: 'VinaX — Free Music Streaming for India', description: 'Free music', canonical: 'https://www.example.test/', h1: 'VinaX', jsonLd: ['WebSite', 'Organization'], words: 420, ogImage: true, noindex: false, issues: [] },
        { path: '/song/kesariya-k1', status: 200, ms: 90, title: 'Kesariya — Arijit Singh | VinaX', description: null, canonical: 'https://www.example.test/song/kesariya-k1', h1: 'Kesariya', jsonLd: ['MusicRecording'], words: 40, ogImage: true, noindex: false, issues: ['no meta description', 'only 40 words of crawlable text'] },
      ] : [],
    },
    '/api/admin/edge': {
      origin: 'https://www.example.test', checkedAt: iso(0), healthy: !full, problems: full ? 1 : 0,
      shell: { status: 200, ms: 80, ok: true, bytes: 4000, cacheStatus: full ? 'HIT' : null, build: full ? 'BxQ7a1' : null, error: null },
      assets: full ? [{ path: '/assets/index-BxQ7a1.js', kind: 'script', status: 200, ms: 40, contentType: 'application/javascript', ok: true, note: null }] : [],
      endpoints: full ? [{ name: 'Catalogue search', path: '/api/cat/search/songs', method: 'GET', status: 502, ms: 2100, ok: false, note: 'expected 2xx' }] : [],
    },
    '/api/admin/releases': full
      ? {
        configured: true,
        release: { tag: 'v14.0.0-build600', name: 'VinaX 14.0.0', notes: 'The database is back', assets: [{ name: 'vinax.apk', url: 'https://example.test/vinax.apk' }] },
        runs: [{ id: 1, name: 'Deploy Worker', title: '14.0.0', status: 'completed', conclusion: 'success', branch: 'main', sha: 'c9b4303', event: 'push', started: iso(5), finished: iso(4.9), number: 88, url: 'https://example.test/r/1' }],
        commits: [{ sha: 'c9b4303', message: '14.0.0: fresh database', author: 'Owner', at: iso(5), url: 'https://example.test/c/1' }],
        live: { build: 6000, version: '14.0.0', minBuild: null },
      }
      : { configured: false },
    '/api/admin/envcheck': {
      checkedAt: iso(0), missingRequired: full ? ['SUPABASE_URL'] : [],
      items: full
        ? [
          { name: 'SUPABASE_URL', group: 'Database', required: true, note: 'the database project', set: false },
          { name: 'FCM_SERVICE_ACCOUNT', group: 'Push', required: false, note: 'Android push (FCM v1)', set: true },
          { name: 'OPENROUTER_API_KEY', group: 'AI', required: false, note: 'OpenRouter', set: true, fallback: 'VINAX_OPENROUTER_API_KEY', usingFallback: true },
        ]
        : [],
    },
    '/api/aimodels': {
      fetchedAt: iso(0),
      providers: ['nvidia', 'openrouter', 'groq', 'gemini', 'cloudflare'].map((id) => ({
        id, label: id, configured: full && id !== 'groq',
        models: full && id === 'nvidia' ? [{ id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', maker: 'meta', context: 128000, vision: false }] : [],
        media: [], tools: [],
      })),
      features: { image: false, speech: false, transcribe: false, embed: false, music: false, codeRun: false },
    },
    '/api/admin/musicapi': { checkedAt: iso(0), mirrors: full ? [{ id: 'vinax-cat', label: 'VinaX catalogue', base: 'https://example.test', ok: true, status: 200, ms: 320, songs: 1, note: null }, { id: 'upstream-1', label: 'wrapper.test', base: 'https://wrapper.test/api', ok: true, status: 200, ms: 210, songs: 1, note: null, health: { status: 'ok', upstreams: [{ name: 'jiosaavn', configured: true, ok: true, latencyMs: 70 }] } }] : [] },
    '/api/admin/catalog-search': full
      ? { items: [{ id: 'k1', name: 'Kesariya', subtitle: 'Arijit Singh', image: '' }], source: 'www.vinaxmusic.online', error: null }
      : { items: [], source: null, error: null },
    '/api/admin/fcmcheck': full
      ? { configured: true, project: 'vinax-music', token: true, fcm: 'ok', detail: 'INVALID_ARGUMENT' }
      : { configured: false, project: null, token: false, fcm: 'skipped', detail: null },
  };
}

/** Answers that depend on the query string. */
function dynamic(full: boolean, p: string, url: URL): Json | null {
  if (p === '/api/admin/analytics') {
    const view = url.searchParams.get('view');
    const base = { configured: true, days: Number(url.searchParams.get('days') || 7), view };
    if (!full) return { ...base, data: view === 'retention' || view === 'funnel' || view === 'skips' ? [] : {} };
    switch (view) {
      case 'music': return { ...base, data: { songs: [{ ...song, plays: 320, listeners: 40 }], artists: [{ artist: 'Arijit Singh', plays: 500, listeners: 60 }], languages: [{ language: 'hindi', plays: 700, listeners: 80 }], rising: [{ title: 'Kesariya', artist: 'Arijit Singh', image: '', plays: 320, prev_plays: 120 }] } };
      case 'geo': return { ...base, data: { countries: [{ country: 'IN', listeners: 100, plays: 900 }], cities: [{ country: 'IN', region: 'Telangana', city: 'Hyderabad', listeners: 40, plays: 300 }] } };
      case 'engagement': return { ...base, data: { byKind: [{ kind: 'play', n: 900, listeners: 100 }], byPlatform: [{ platform: 'android', n: 700, listeners: 80 }], hourly: { cells: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, hh) => (hh > 17 && hh < 23 ? 10 + d : 1))), peak: { day: 6, hour: 21, n: 16 } }, segments: { new7d: 12, returning7d: 40, inactive30d: 20, dormant: 48, power: 9 }, total: 1200, timeline: timeline(true), platforms: { versions: [{ platform: 'android', appVersion: '14.0.0', listeners: 80 }] } } };
      case 'retention': return { ...base, data: [{ week: day(14), size: 20, d1: 8, d7: 6, d30: 2 }] };
      case 'funnel': return { ...base, data: [{ id: 'open', label: 'Opened the app', listeners: 100 }, { id: 'play', label: 'Played a song', listeners: 70 }] };
      case 'skips': return { ...base, data: [{ ...song, plays: 50, skips: 30, rate: 60 }] };
      case 'errors': return { ...base, data: { total: 3, byDay: timeline(true).map((t) => ({ day: t.day, hits: t.errors })), top: [{ errorKind: 'audio', message: 'decode failed', hits: 3, lastSeen: iso(2), platforms: ['web'], versions: ['14.0.0'] }] } };
      default: return { ...base, data: {} };
    }
  }
  if (p === '/api/admin/listeners' && (url.searchParams.get('id') || url.searchParams.get('account'))) {
    return full
      ? { configured: true, profile: { listener: { id: 'd_1', display_name: 'Asha Rao', handle: 'asha', platform: 'android', app_version: '14.0.0', country: 'IN', city: 'Hyderabad', now_playing: { title: 'Kesariya', artist: 'Arijit Singh' }, first_seen: iso(400), last_seen: iso(0) }, account: { id: 'g1', email: 'asha@example.com', email_verified: true, name: 'Asha Rao', created_at: iso(300) }, backup: { version: 4, bytes: 12000, updatedAt: iso(2) }, stats: { events: 900, plays: 300, plays30d: 80, activeDays30d: 12, errors: 1 }, topSongs: [{ title: 'Kesariya', artist: 'Arijit Singh', plays: 40 }], languages: [{ language: 'hindi', plays: 200 }], events: [{ at: iso(0), kind: 'play', song_title: 'Kesariya', song_artist: 'Arijit Singh', platform: 'android' }] } }
      : { configured: true, profile: {} };
  }
  if (p === '/api/admin/settings' && url.searchParams.get('key')) {
    const key = url.searchParams.get('key');
    return full ? { configured: true, key, value: key === 'site-mode' ? { mode: 'live' } : null, updatedAt: iso(3), updatedBy: 'owner', history: [{ at: iso(3), by: 'owner', value: { mode: 'live' } }, { at: iso(50), by: 'owner', value: null }] } : { configured: true, key, value: null, history: [] };
  }
  return null;
}

interface Backend { posts: Array<{ path: string; body: Json }> }

async function open(page: Page, mode: 'full' | 'empty' | 'down'): Promise<Backend> {
  const backend: Backend = { posts: [] };
  const full = mode === 'full';
  const fx = fixtures(full);
  await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'test-token'));
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    const p = url.pathname;
    if (!p.startsWith('/api/')) return route.continue();
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}') as Json;
      backend.posts.push({ path: p, body });
      if (p === '/api/admin/ailab') return route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: SSE });
      if (p === '/api/admin/push' && body.dryRun === true) return route.fulfill({ json: { dryRun: true, web: 40, fcm: 15, audience: 'everyone' } });
      if (p === '/api/admin/push') return route.fulfill({ json: { ok: true, id: 8, web: { total: 40, sent: 39, gone: 1, failed: {} }, fcm: { total: 15, sent: 15, failed: {} }, audience: 'everyone' } });
      return route.fulfill({ json: { ok: true } });
    }
    if (mode === 'down') return route.fulfill({ status: 502, json: { error: 'db_unavailable' } });
    if (p === '/api/admin/enginetest') return route.fulfill({ json: { key: url.searchParams.get('key'), provider: 'nvidia', model: 'm', status: 200, ms: 500, head: 'OK', media: [], tools: [] } });
    const dyn = dynamic(full, p, url);
    if (dyn) return route.fulfill({ json: dyn });
    const body = fx[p];
    return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  return backend;
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/net::|Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  return errors;
}

async function visit(page: Page, route: string): Promise<string> {
  await page.goto(`/admin/#/${route}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#pageBody .state.loading, #pageBody .skeleton')).toHaveCount(0, { timeout: 10_000 });
  const text = await page.locator('#pageBody').innerText();
  expect(text, route).not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/);
  return text;
}

test.describe('owner console · pages', () => {
  test('every tab renders with data', async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, 'full');
    expect(await visit(page, 'overview')).toContain('2 new feedback messages');
    expect(await visit(page, 'live/now')).toContain('Asha');
    expect(await visit(page, 'live/rooms')).toContain('ABC234');
    expect(await visit(page, 'listeners')).toContain('Asha Rao');
    await page.locator('#pageBody tbody tr').first().click();
    await expect(page.locator('#drawer')).toContainText('asha@example.com');
    await page.keyboard.press('Escape');
    expect(await visit(page, 'analytics/music')).toContain('Kesariya');
    expect(await visit(page, 'analytics/engagement')).toContain('Hour of the week');
    expect(await visit(page, 'analytics/retention')).toContain('40%');
    expect(await visit(page, 'feedback')).toContain('The lyrics stop scrolling');
    expect(await visit(page, 'experiments')).toContain('home-shelf-order');
    expect(await visit(page, 'ai/usage')).toContain('meta/llama-3.3-70b-instruct');
    expect(await visit(page, 'catalog/blocked')).toContain('Bad Song');
    expect(await visit(page, 'publish?key=flags')).toContain('Feature switches');
    expect(await visit(page, 'notify/history')).toContain('Diwali playlist');
    expect(await visit(page, 'database/tables')).toContain('events');
    expect(await visit(page, 'database/jobs')).toContain('Overdue');
    expect(await visit(page, 'database/audit')).toContain('greeting published');
    expect(await visit(page, 'health/status')).toContain('AI providers');
    expect(await visit(page, 'health/errors')).toContain('decode failed');
    expect(await visit(page, 'health/edge')).toContain('Catalogue search');
    expect(await visit(page, 'health/releases')).toContain('VinaX 14.0.0');
    expect(await visit(page, 'health/env')).toContain('SUPABASE_URL');
    expect(await visit(page, 'ai/probe')).toContain('No probes yet');
    await page.getByRole('button', { name: 'Check sources' }).click();
    await expect(page.locator('#pageBody')).toContainText('VinaX catalogue');
    expect(await visit(page, 'catalog/lookup?q=kesariya')).toContain('Kesariya');
    const notify = await visit(page, 'notify/setup');
    expect(notify).toContain('FCM_SERVICE_ACCOUNT');
    await expect(page.locator('#pageBody')).toContainText('Android push works');
    expect(errors).toEqual([]);
  });

  test('empty answers show friendly empty states', async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, 'empty');
    for (const tab of TABS) await visit(page, tab);
    await visit(page, 'notify/setup');
    await expect(page.locator('#pageBody')).toContainText('Android push is not set up');
    expect(errors).toEqual([]);
  });

  test('a failing server shows an error with retry on every tab, never a blank page', async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, 'down');
    for (const tab of TABS.filter((t) => !ON_DEMAND.has(t))) {
      await visit(page, tab);
      await expect(page.locator('#pageBody .state.error').first(), tab).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('the database setup card shows when the Worker has no database', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'test-token'));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (!url.origin.startsWith('http://localhost')) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      return route.fulfill({ json: { configured: false } });
    });
    expect(await visit(page, 'overview')).toContain('Database not set up');
    expect(await visit(page, 'listeners')).toContain('schema.sql');
    expect(errors).toEqual([]);
  });

  test('the AI lab sends the bench body the server expects and shows the reply', async ({ page }) => {
    const errors = collectErrors(page);
    const backend = await open(page, 'full');
    await visit(page, 'ai/lab');
    await page.getByRole('button', { name: 'Run', exact: true }).first().click();
    await expect(page.locator('#pageBody')).toContainText('Hello from the lab.');
    expect(backend.posts.filter((p) => p.path === '/api/admin/ailab').at(-1)?.body).toEqual({
      provider: 'nvidia',
      messages: [{ role: 'user', content: 'Suggest three upbeat Telugu songs for a morning walk, one line each.' }],
      maxTokens: 300,
    });
    expect(errors).toEqual([]);
  });

  test('the push composer previews the audience, then sends with a dedupe key', async ({ page }) => {
    const errors = collectErrors(page);
    const backend = await open(page, 'full');
    await visit(page, 'notify/send');
    await page.getByLabel('Body').fill('New this week: the Telugu hits playlist is live.');
    await page.getByRole('button', { name: 'Preview audience' }).click();
    await expect(page.locator('#pageBody')).toContainText('40 browsers and 15 Android devices');
    const preview = backend.posts.filter((p) => p.path === '/api/admin/push').at(-1)?.body;
    expect(preview?.dryRun).toBe(true);
    expect(preview?.body).toBe('New this week: the Telugu hits playlist is live.');
    await page.getByRole('button', { name: 'Send push' }).click();
    await page.getByPlaceholder('SEND').fill('SEND');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('#pageBody')).toContainText('Sent to everyone');
    const sent = backend.posts.filter((p) => p.path === '/api/admin/push').at(-1)?.body;
    expect(sent?.dryRun).toBeUndefined();
    expect(sent?.dedupeKey).toBe(preview?.dedupeKey);
    expect(errors).toEqual([]);
  });

  test('publishing a setting posts the key and the value', async ({ page }) => {
    const errors = collectErrors(page);
    const backend = await open(page, 'full');
    await visit(page, 'publish?key=greeting');
    await page.getByLabel('Text').fill('Happy Diwali!');
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.locator('#toasts')).toContainText('Published');
    expect(backend.posts.filter((p) => p.path === '/api/admin/settings').at(-1)?.body).toEqual({ key: 'greeting', value: { text: 'Happy Diwali!' } });
    expect(errors).toEqual([]);
  });
});
