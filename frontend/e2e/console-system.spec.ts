import { test, expect, type Page } from './support/test';

/**
 * 13.8 — owner console System group (/admin/, static files): Health
 * (system status, app errors, endpoints, scheduled jobs, data quality,
 * releases, server secrets, status note), Feedback, Database (tables, browse
 * data, audit trail, fresh database) and Settings (feature switches,
 * maintenance, app versions, backup & restore, runbook).
 *
 * Every tab renders with realistic fixtures, with a freshly wiped database
 * (friendly empty states, jobs "Not run yet", "GITHUB_TOKEN not set") and with
 * a database outage (inline error with retry); every write sends the exact
 * POST body the server validates. All non-localhost network is aborted; zero
 * page or console errors allowed; no "undefined" / "NaN" / "null" on screen.
 */

const iso = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const day = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

const TABS = [
  'health/status', 'health/errors', 'health/edge', 'health/cron', 'health/data', 'health/releases', 'health/env', 'health/status-note',
  'feedback',
  'data/tables', 'data/query', 'data/audit', 'data/fresh',
  'settings/flags', 'settings/maintenance', 'settings/versions', 'settings/backup', 'settings/runbook',
];

const TABLES = ['vinax_events', 'vinax_ai_events', 'vinax_accounts', 'vinax_users', 'vinax_feedback', 'vinax_config', 'vinax_trend_runs'];

type Fixtures = Record<string, unknown> & { config: Record<string, unknown> };

function full(): Fixtures {
  return {
    '/api/admin/health': {
      time: iso(0),
      ai: [
        { key: 'NVIDIA · dj, chat', provider: 'nvidia', env: 'NVIDIA_API_KEY', envInUse: 'NVIDIA_API_KEY', lanes: ['dj', 'chat'], media: [], tools: [], configured: true, ok: true, status: 200, model: 'meta/llama-3.3-70b-instruct', note: null },
        { key: 'OpenRouter · search', provider: 'openrouter', env: 'OPENROUTER_API_KEY', envInUse: 'VINAX_OPENROUTER_API_KEY', lanes: ['search'], media: [], tools: [], configured: true, ok: false, status: 429, model: 'x/free', note: '429:x/free' },
        { key: 'Groq · mini', provider: 'groq', env: 'GROQ_API_KEY', envInUse: null, lanes: ['mini'], media: [], tools: [], configured: false, ok: false, status: null, model: null, note: 'not configured' },
      ],
      lanes: [
        { lane: 'dj', calls: 420, okPct: 97.6, p50: 1800, p95: 5200, p99: 8000, hops: 6, emptyStreams: 1, authErrors: 0, provider: 'nvidia', keySet: true },
        { lane: 'mini', calls: 0, okPct: 0, p50: null, p95: null, p99: null, hops: 0, emptyStreams: 0, authErrors: 0, provider: 'groq', keySet: false },
      ],
      lanesReadable: true,
      supabase: { configured: true, readable: true, error: null, upstreamStatus: null, lastEventAt: iso(0.05), note: null },
      unavailable: [],
    },
    '/api/admin/technical': {
      configured: true, days: 7,
      versions: [{ app_version: '13.7.4', platform: 'web', users: 812 }],
      errors: [{ error_kind: 'playback', message: 'MediaError: no supported sources', hits: 37, last_seen: iso(0.4) }],
      errorsByDay: [{ day: day(0), hits: 12 }, { day: day(2), hits: 20 }],
      summary: { errors_24h: 12, plays_24h: 5400, active_sessions: 77, versions: 1 },
      vitals: [
        { metric: 'LCP', p75: 2310, unit: 'ms', good: 800, ni: 150, poor: 50, count: 1000 },
        { metric: 'INP', p75: 260, unit: 'ms', good: 600, ni: 300, poor: 100, count: 1000 },
        { metric: 'CLS', p75: 0.31, unit: '', good: 500, ni: 200, poor: 300, count: 1000 },
      ],
      lyricMisses: [{ song_id: 's1', song_title: 'Naatu Naatu', song_artist: 'Rahul Sipligunj', hits: 9 }],
      unavailable: [],
    },
    '/api/admin/edge': {
      origin: 'https://www.example.test', checkedAt: iso(0), healthy: false, problems: 1,
      shell: { status: 200, ms: 80, ok: true, bytes: 4000, cacheStatus: 'HIT', build: 'BxQ7a1', error: null },
      assets: [{ path: '/assets/index-BxQ7a1.js', kind: 'script', status: 200, ms: 40, contentType: 'application/javascript', ok: true, note: null }],
      endpoints: [{ name: 'Catalogue search', path: '/api/cat/search/songs', method: 'GET', status: 502, ms: 2100, ok: false, note: 'expected 2xx' }],
    },
    '/api/admin/cron': {
      configured: true, checkedAt: iso(0), unavailable: [],
      jobs: [
        { id: 'ai-daily-push', label: 'AI daily push', schedule: '5× a day', note: '', lastAt: iso(2), ageMin: 120, ok: true, neverRan: false, maxAgeMin: 540, readable: true },
        { id: 'song-push', label: 'Song push', schedule: 'daily', note: '', lastAt: iso(40), ageMin: 2400, ok: false, neverRan: false, maxAgeMin: 1560, readable: true },
      ],
    },
    '/api/admin/dataquality': { configured: true, score: 87.5, metrics: { originVerifiedPct: 98, countryResolvedPct: 71, aiOkPct: 96.2, aiContentPct: 85 }, slos: [{ name: 'AI success', targetPct: 98, actualPct: 96.2, budgetBurnedPct: 190 }], sampled: { events: 5000, aiEvents: 1800 } },
    '/api/admin/releases': {
      configured: true,
      release: { tag: 'v13.7.4-build512', name: 'VinaX 13.7.4', notes: 'Fixes', assets: [{ name: 'vinax.apk', url: 'https://example.test/vinax.apk' }] },
      runs: [{ id: 1, name: 'Deploy Worker', title: '13.7.4', status: 'completed', conclusion: 'success', branch: 'main', sha: 'c9b4303', event: 'push', started: iso(5), finished: iso(4.9), number: 88, url: 'https://example.test/r/1' }],
      commits: [{ sha: 'c9b4303', message: '13.7.4: Get the app bar', author: 'Owner', at: iso(5), url: 'https://example.test/c/1' }],
      live: { build: 5512, version: '13.7.4', minBuild: null },
    },
    '/api/admin/envcheck': {
      checkedAt: iso(0), missingRequired: ['CRON_SECRET'],
      items: [
        { name: 'SUPABASE_URL', group: 'Data', required: true, note: 'database URL', set: true },
        { name: 'CRON_SECRET', group: 'Cron', required: true, note: 'scheduled job secret', set: false },
        { name: 'OPENROUTER_API_KEY', group: 'AI', required: false, note: 'OpenRouter', set: true, fallback: 'VINAX_OPENROUTER_API_KEY', usingFallback: true },
      ],
    },
    '/api/status': {
      generatedAt: iso(0), windowDays: 90, overall: 'outage', note: 'Search is slow',
      components: [{ id: 'api', name: 'API', status: 'down', latencyMs: null, checkedAt: iso(0.3), uptime90: 97.92, days: [{ day: day(1), up: 46, total: 48 }, { day: day(0), up: 17, total: 20 }] }],
    },
    '/api/site-mode': { mode: 'live', note: '' },
    '/api/version': { build: 5512, version: '13.7.4', minBuild: 5400 },
    '/changelog.json': { generatedAt: iso(3), releases: [{ version: '13.7.4', title: 'Get the app', changes: [{ type: 'new', text: 'A Get the app bar' }] }] },
    '/api/admin/feedback': {
      configured: true,
      feedback: [
        { id: 41, type: 'bug', name: 'Asha', message: 'Lyrics do not scroll on my phone.', app_version: '13.7.4', platform: 'android', country: 'IN', city: 'Hyderabad', status: 'new', created_at: iso(1) },
        { id: 40, type: 'idea', name: null, message: 'Please add a sleep timer.', app_version: '13.7.3', platform: 'web', country: 'US', city: null, status: 'read', created_at: iso(30) },
        { id: 39, type: 'other', name: 'Ravi', message: 'Thanks for the app!', app_version: null, platform: null, country: null, city: null, status: 'resolved', created_at: iso(200) },
      ],
    },
    '/api/admin/tables': {
      configured: true, totalRows: 50400, checkedAt: iso(0), unavailable: ['vinax_trend_runs'],
      tables: TABLES.map((n, i) => (n === 'vinax_trend_runs'
        ? { name: n, note: 'trend refresh runs', total: null, last24h: null, newestAt: null, ageMin: null, readable: false, error: 'not_found' }
        : { name: n, note: 'rows', total: i === 0 ? 50000 : i * 20, last24h: i, newestAt: iso(i), ageMin: i * 60, readable: true })),
    },
    '/api/admin/query': { configured: true, table: 'vinax_events', columns: ['created_at', 'type', 'platform'], rows: [{ created_at: iso(1), type: 'play', platform: 'web' }], truncated: false },
    '/api/admin/audit': { configured: true, items: [{ kind: 'config', text: 'updated flags (52 bytes)', at: iso(2), target: 'flags', before: { codeRun: true }, after: { codeRun: false } }] },
    config: {
      flags: { codeRun: true, listenTogether: false, aiHome: true },
      'status-note': 'Search is slow',
      'min-version': { build: 5400, reason: 'Security fix', setAt: iso(48) },
      runbook: [{ title: 'App stuck on Updating', body: 'Clear site data, reopen.', updatedAt: iso(100) }],
    },
  };
}

/** A freshly wiped database: every table exists and is empty, nothing published, no GitHub token. */
function empty(): Fixtures {
  return {
    '/api/admin/health': {
      time: iso(0),
      ai: [{ key: 'NVIDIA · chat', provider: 'nvidia', env: 'NVIDIA_API_KEY', envInUse: null, lanes: ['chat'], media: [], tools: [], configured: false, ok: false, status: null, model: null, note: 'not configured' }],
      lanes: [{ lane: 'chat', calls: 0, okPct: 0, p50: null, p95: null, p99: null, hops: 0, emptyStreams: 0, authErrors: 0, provider: 'nvidia', keySet: false }],
      lanesReadable: true,
      supabase: { configured: true, readable: true, error: null, upstreamStatus: null, lastEventAt: null, note: 'The events table is readable but empty — no event has been written yet.' },
      unavailable: [],
    },
    '/api/admin/technical': { configured: true, days: 7, versions: [], errors: [], errorsByDay: [], summary: { errors_24h: 0, plays_24h: 0, active_sessions: 0, versions: 0 }, vitals: ['LCP', 'INP', 'CLS'].map((m) => ({ metric: m, p75: null, unit: 'ms', good: 0, ni: 0, poor: 0, count: 0 })), lyricMisses: [], unavailable: [] },
    '/api/admin/edge': { origin: 'https://www.example.test', checkedAt: iso(0), healthy: true, problems: 0, shell: { status: 200, ms: 80, ok: true, bytes: 4000, cacheStatus: null, build: null, error: null }, assets: [], endpoints: [] },
    '/api/admin/cron': { configured: true, checkedAt: iso(0), unavailable: [], jobs: ['ai-daily-push', 'song-push', 'status-tick'].map((id) => ({ id, label: id, schedule: 'hourly', note: '', lastAt: null, ageMin: null, ok: null, neverRan: true, maxAgeMin: 75, readable: true })) },
    '/api/admin/dataquality': { configured: true, score: null, metrics: { originVerifiedPct: null, countryResolvedPct: null, aiOkPct: null, aiContentPct: null }, slos: [{ name: 'AI success', targetPct: 98, actualPct: null, budgetBurnedPct: null }], sampled: { events: 0, aiEvents: 0 }, unavailable: [] },
    '/api/admin/releases': { configured: false },
    '/api/admin/envcheck': { checkedAt: iso(0), missingRequired: [], items: [{ name: 'SUPABASE_URL', group: 'Data', required: true, note: 'database URL', set: true }] },
    '/api/status': { generatedAt: iso(0), windowDays: 90, overall: 'unknown', note: null, components: [{ id: 'website', name: 'Website', status: 'unknown', latencyMs: null, checkedAt: null, uptime90: null, days: [] }] },
    '/api/site-mode': { mode: 'live', note: '' },
    '/api/version': { __status: 503, error: 'not_configured' },
    '/changelog.json': { __status: 404, error: 'not_found' },
    '/api/admin/feedback': { configured: true, feedback: [] },
    '/api/admin/tables': { configured: true, totalRows: 0, checkedAt: iso(0), unavailable: [], tables: TABLES.map((n) => ({ name: n, note: 'rows', total: 0, last24h: 0, newestAt: null, ageMin: null, readable: true })) },
    // A response without `columns` must still draw its header from the table's known columns.
    '/api/admin/query': { configured: true, table: 'vinax_events', rows: [], truncated: false },
    '/api/admin/audit': { configured: true, items: [] },
    config: {},
  };
}

interface Backend { fx: Fixtures; posts: Array<{ path: string; body: Record<string, unknown> }>; gets: string[] }

async function mockApi(page: Page, fx: Fixtures, down = false): Promise<Backend> {
  const backend: Backend = { fx, posts: [], gets: [] };
  await page.addInitScript(() => {
    sessionStorage.setItem('vinax_admin_token', 'test-token');
  });
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  const handler = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}') as Record<string, unknown>;
      backend.posts.push({ path: p, body });
      if (down) return send({ error: 'db_unavailable' }, 503);
      if (p === '/api/admin/appconfig') {
        const key = String(body.key);
        if (body.value === null) delete fx.config[key];
        else fx.config[key] = body.value;
        return send(body.value === null ? { ok: true, cleared: true } : { ok: true });
      }
      if (p === '/api/admin/maintenance' && body.action === 'site_mode') {
        const mode = body.mode === 'maintenance' ? 'maintenance' : 'live';
        fx['/api/site-mode'] = { mode, note: body.note ?? '' };
        return send({ ok: true, mode });
      }
      return send({ ok: true });
    }
    backend.gets.push(p + url.search);
    if (p === '/api/version' && !down) {
      const v = fx[p] as Record<string, unknown>;
      return send(v, Number(v.__status) || 200);
    }
    if (down) return send({ configured: true, error: 'db_unavailable' }, 502);
    if (p === '/api/admin/appconfig') {
      const key = url.searchParams.get('key') ?? '';
      const value = fx.config[key];
      return send({ configured: true, value: value === undefined ? null : value, updated_at: value === undefined ? null : iso(1) });
    }
    const f = fx[p] as Record<string, unknown> | undefined;
    if (!f) return send({ configured: true });
    return send(f, Number(f.__status) || 200);
  };
  await page.route('**/api/**', handler);
  await page.route('**/changelog.json', handler);
  return backend;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function open(page: Page, route: string): Promise<string> {
  await page.goto('/admin/#/' + route);
  await expect(page.locator('#pageBody')).not.toBeEmpty();
  await expect(page.locator('#pageBody .state.loading, #pageBody .skeleton')).toHaveCount(0, { timeout: 10_000 });
  const text = await page.locator('#pageBody').innerText();
  expect(text, `${route} shows a raw value`).not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/);
  return text;
}

async function confirm(page: Page, label: string): Promise<void> {
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  const typed = modal.locator('input');
  if (await typed.count()) await typed.fill((await typed.getAttribute('placeholder')) ?? '');
  await modal.locator('.modal-foot button', { hasText: label }).click();
  await expect(modal).toHaveCount(0);
}

async function lastPost(backend: Backend, path: string): Promise<Record<string, unknown>> {
  await expect.poll(() => backend.posts.filter((p) => p.path === path).length).toBeGreaterThan(0);
  return [...backend.posts].reverse().find((p) => p.path === path)!.body;
}

test.describe('owner console · System pages', () => {
  test('every tab renders with live data', async ({ page }) => {
    const errors = watchErrors(page);
    const backend = await mockApi(page, full());
    const probes: Record<string, RegExp> = {
      'health/status': /AI keys working[\s\S]*OpenRouter[\s\S]*Failing[\s\S]*old name/,
      'health/errors': /Errors · 24h[\s\S]*MediaError[\s\S]*Needs work/,
      'health/edge': /problem[\s\S]*Failing[\s\S]*Catalogue search/,
      'health/cron': /overdue[\s\S]*Song push[\s\S]*Overdue/,
      'health/data': /Quality score[\s\S]*Over budget/,
      'health/releases': /v13\.7\.4-build512[\s\S]*Passed[\s\S]*Deploy Worker/,
      'health/env': /Missing required secrets: CRON_SECRET[\s\S]*VINAX_OPENROUTER_API_KEY/,
      'health/status-note': /Showing[\s\S]*Outage[\s\S]*Note shown: Search is slow[\s\S]*Status history/,
      feedback: /Open bugs[\s\S]*Bug[\s\S]*Lyrics do not scroll/,
      'data/tables': /1 table is missing: vinax_trend_runs[\s\S]*Housekeeping/,
      'data/query': /1 row from vinax_events/,
      'data/audit': /Setting[\s\S]*updated flags/,
      'data/fresh': /Action needed[\s\S]*vinax-13\.sql/,
      'settings/flags': /Listen Together[\s\S]*Off/,
      'settings/maintenance': /Site mode[\s\S]*Live[\s\S]*Scheduled maintenance/,
      'settings/versions': /Builds below 5,400 must update[\s\S]*build 5,512[\s\S]*A Get the app bar/,
      'settings/backup': /Published settings[\s\S]*min-version/,
      'settings/runbook': /Change the owner password[\s\S]*vinax-wipe\.sql[\s\S]*App stuck on Updating/,
    };
    for (const t of TABS) {
      const text = await open(page, t);
      expect(text, t).toMatch(probes[t]);
    }
    // The AI key check spends tokens: one request for the whole run of tabs above.
    expect(backend.gets.filter((g) => g.startsWith('/api/admin/health')).length).toBeLessThanOrEqual(1);
    expect(backend.posts, 'viewing pages must not write').toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a freshly wiped database shows friendly empty states', async ({ page }) => {
    const errors = watchErrors(page);
    const backend = await mockApi(page, empty());
    const probes: Record<string, RegExp> = {
      'health/status': /readable but empty[\s\S]*No AI calls in the last 24 hours/,
      'health/errors': /No errors in this period[\s\S]*No speed data yet/,
      'health/cron': /No job has run since the database was created[\s\S]*Not run yet/,
      'health/data': /Not enough data yet/,
      'health/releases': /GITHUB_TOKEN not set/,
      'health/status-note': /No uptime data yet/,
      feedback: /No feedback yet/,
      'data/tables': /freshly reset database/,
      'data/query': /0 rows from vinax_events[\s\S]*No rows/,
      'data/audit': /No console changes yet/,
      'data/fresh': /schema is complete[\s\S]*Waiting/,
      'settings/flags': /Nothing published — every feature is on/,
      'settings/versions': /No minimum[\s\S]*GITHUB_TOKEN is not set[\s\S]*Not on this host yet/,
      'settings/backup': /Nothing is published yet/,
      'settings/runbook': /No notes yet/,
    };
    for (const t of TABS) {
      const text = await open(page, t);
      // Jobs that never ran read "Not run yet", never "Overdue".
      await expect(page.locator('#pageBody .pill', { hasText: 'Overdue' })).toHaveCount(0);
      if (probes[t]) expect(text, t).toMatch(probes[t]);
    }
    expect(backend.posts).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a database outage shows an error with retry, never a blank page', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, full(), true);
    for (const t of TABS.filter((x) => !['settings/runbook'].includes(x))) {
      await open(page, t);
      await expect(page.locator('#pageBody .state.error').first(), t).toBeVisible();
    }
    await expect(page.locator('#pageBody .state.error').first()).toContainText('not reachable');
    expect(errors).toEqual([]);
  });

  test('Health and Feedback writes send the bodies the server expects', async ({ page }) => {
    const errors = watchErrors(page);
    const backend = await mockApi(page, full());

    await open(page, 'health/errors');
    await page.getByRole('button', { name: 'Clear all errors' }).click();
    await confirm(page, 'Clear errors');
    expect(await lastPost(backend, '/api/admin/maintenance')).toEqual({ action: 'clear_errors' });

    await open(page, 'health/status-note');
    await page.locator('#pageBody textarea').fill('API is slow right now');
    await page.getByRole('button', { name: 'Publish note' }).click();
    expect(await lastPost(backend, '/api/admin/appconfig')).toEqual({ key: 'status-note', value: 'API is slow right now' });
    await expect(page.getByRole('button', { name: 'All clear' })).toBeEnabled();
    await page.getByRole('button', { name: 'All clear' }).click();
    await expect.poll(() => backend.posts.length).toBe(3);
    expect(await lastPost(backend, '/api/admin/appconfig')).toEqual({ key: 'status-note', value: null });

    await open(page, 'feedback');
    await page.locator('tr.clickable', { hasText: 'Lyrics do not scroll' }).click();
    await page.locator('#drawer').getByRole('button', { name: 'Mark resolved' }).click();
    expect(await lastPost(backend, '/api/admin/feedback')).toEqual({ id: 41, status: 'resolved' });
    await page.getByRole('button', { name: 'Delete resolved' }).click();
    await confirm(page, 'Delete resolved');
    expect(await lastPost(backend, '/api/admin/maintenance')).toEqual({ action: 'clear_feedback' });
    expect(errors).toEqual([]);
  });

  test('Database writes and the read-only browser send the right requests', async ({ page }) => {
    const errors = watchErrors(page);
    const backend = await mockApi(page, full());

    await open(page, 'data/tables');
    await page.getByRole('button', { name: 'Delete old events' }).click();
    await confirm(page, 'Delete');
    expect(await lastPost(backend, '/api/admin/maintenance')).toEqual({ action: 'purge_events', days: 90 });
    await page.getByRole('button', { name: 'Trim AI log' }).click();
    await confirm(page, 'Delete');
    expect(await lastPost(backend, '/api/admin/maintenance')).toEqual({ action: 'trim_ai', days: 14 });

    await open(page, 'data/query');
    await page.getByLabel('Table').selectOption('vinax_ai_events');
    await page.getByLabel('Filter column').selectOption('model');
    await page.getByLabel('Equals').fill('gemini-2.0-flash');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect.poll(() => backend.gets.filter((g) => g.includes('table=vinax_ai_events')).length).toBe(1);
    const q = new URLSearchParams(backend.gets.find((g) => g.includes('table=vinax_ai_events'))!.split('?')[1]);
    expect(Object.fromEntries(q)).toEqual({ table: 'vinax_ai_events', hours: '24', limit: '200', col: 'model', val: 'gemini-2.0-flash' });

    await open(page, 'data/audit');
    await page.locator('tr.clickable', { hasText: 'updated flags' }).click();
    await expect(page.locator('#drawer')).toContainText('Before');
    await expect(page.locator('#drawer')).toContainText('codeRun');
    expect(errors).toEqual([]);
  });

  test('Settings writes publish the exact config shapes and never flip the site by accident', async ({ page }) => {
    const errors = watchErrors(page);
    const backend = await mockApi(page, full());

    await open(page, 'settings/flags');
    await page.getByRole('switch', { name: 'Run and preview code in VinaX AI' }).click({ force: true });
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    expect(await lastPost(backend, '/api/admin/appconfig')).toEqual({ key: 'flags', value: { codeRun: false, listenTogether: false, aiHome: true } });

    await open(page, 'settings/maintenance');
    await page.getByLabel('Message listeners see').fill('Back in 30 minutes');
    await page.getByRole('button', { name: 'Save message' }).click();
    // Saving the message while live must stay live (the old console forced 'live' even in maintenance).
    expect(await lastPost(backend, '/api/admin/maintenance')).toEqual({ action: 'site_mode', mode: 'live', note: 'Back in 30 minutes' });
    await page.getByRole('button', { name: 'Switch to maintenance' }).click();
    await confirm(page, 'Switch to maintenance');
    expect(await lastPost(backend, '/api/admin/maintenance')).toEqual({ action: 'site_mode', mode: 'maintenance', note: 'Back in 30 minutes' });
    await expect(page.getByRole('button', { name: 'Update message' })).toBeVisible();
    await page.getByLabel('Message listeners see').fill('Nearly done');
    await page.getByRole('button', { name: 'Update message' }).click();
    await expect.poll(async () => (await lastPost(backend, '/api/admin/maintenance')).note).toBe('Nearly done');
    expect(await lastPost(backend, '/api/admin/maintenance')).toEqual({ action: 'site_mode', mode: 'maintenance', note: 'Nearly done' });

    await open(page, 'settings/versions');
    await expect(page.locator('#pageBody')).toContainText('build 5,512');
    await page.getByLabel('Minimum build number').fill('5500');
    await page.getByLabel('Reason').fill('Playback fix');
    await page.getByRole('button', { name: 'Publish minimum' }).click();
    await confirm(page, 'Publish');
    const mv = await lastPost(backend, '/api/admin/appconfig');
    expect(mv.key).toBe('min-version');
    expect(mv.value).toMatchObject({ build: 5500, reason: 'Playback fix' });

    await open(page, 'settings/runbook');
    await page.getByLabel('Title').fill('Rotate keys');
    await page.getByLabel('Steps').fill('Step one');
    await page.getByRole('button', { name: 'Save note' }).click();
    const rb = await lastPost(backend, '/api/admin/appconfig');
    expect(rb.key).toBe('runbook');
    expect((rb.value as Array<{ title: string }>).map((n) => n.title)).toEqual(['Rotate keys', 'App stuck on Updating']);

    await open(page, 'settings/backup');
    const before = backend.posts.length;
    await page.locator('#pageBody input[type="file"]').setInputFiles({
      name: 'backup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ exportedAt: iso(1), config: { flags: { codeRun: true }, greeting: { text: 'Hi' }, bogus: 1 } })),
    });
    await expect(page.locator('#pageBody')).toContainText('skipped (not a console setting): bogus');
    await page.getByRole('checkbox', { name: 'Restore greeting' }).uncheck();
    await page.getByRole('button', { name: 'Publish selected' }).click();
    await confirm(page, 'Publish');
    await expect(page.locator('#pageBody')).toContainText('Restore result');
    expect(backend.posts.slice(before).map((p) => p.body)).toEqual([{ key: 'flags', value: { codeRun: true } }]);
    expect(errors).toEqual([]);
  });
});
