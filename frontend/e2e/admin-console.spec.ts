import { test, expect, type Page } from '@playwright/test';

/**
 * Admin console (/admin/ — a static page, not the React app) with every
 * backend answer mocked: the session is seeded with an admin token, every
 * `#nav button[data-sec]` is opened and must render a non-empty panel (with
 * content probes for the panels that have known fixtures), then the key
 * interactions are exercised — catalog search, song drilldown, query console,
 * synonyms publish, broadcast publish, pinning a tool. Zero page errors and
 * zero console errors tolerated. All non-localhost network is aborted.
 */

const iso = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const heat = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d * 3 + h) % 11));

/** Published config keys (`/api/admin/appconfig?key=` and the public `/api/appconfig`). */
function initialConfig(): Record<string, unknown> {
  return {
    flags: { codeRun: true, listenTogether: false, betaShelf: true },
    runbook: [{ title: 'Worker 5xx spike', body: 'Check the edge status page, then roll back.', updatedAt: iso(30) }],
    'trending-pins': ['Kesariya', 'Naatu Naatu'],
    'status-note': 'All systems normal.',
    banners: [],
    'home-config': {},
    festival: {},
    'search-synonyms': { arr: 'A. R. Rahman' },
    'catalog-sources': { 'vinax-render': false },
    'language-order': ['telugu', 'hindi'],
    'ai-starters': ['Suggest 5 {lang} songs'],
    'ai-quick': [{ icon: 'S', label: 'Songs', prompt: 'Suggest songs for ', mode: 'muse' }],
    'ai-rules': 'Mention the Diwali mixes when relevant.',
    'maintenance-window': { start: iso(-2), end: iso(-4), note: 'DB upgrade' },
    'min-version': { build: 5140, reason: 'security' },
    broadcast: { id: 'b1', text: 'Hello everyone', link: '/later' },
    greeting: { text: 'Festival week' },
    'support-faq': [{ q: 'How do I download?', a: 'Use the Android app.' }],
  };
}

const MOCK: Record<string, unknown> = {
  '/api/admin/overview': { totals: {}, today: {}, series: [] },
  '/api/admin/retention': { configured: true, cohorts: [{ cohort_week: iso(24 * 14), cohort_size: 120, d1: 42.5, d7: 21, d30: 9 }, { cohort_week: iso(24 * 7), cohort_size: 88, d1: 38, d7: 19, d30: null }] },
  '/api/admin/dataquality': { score: 87, sampled: 5000, metrics: { originVerifiedPct: 98, countryResolvedPct: 91, aiOkPct: 96, aiContentPct: 94 }, slos: [{ name: 'AI success', targetPct: 95, actualPct: 96, budgetBurnedPct: 40 }, { name: 'Play origin', targetPct: 97, actualPct: 98, budgetBurnedPct: 12 }] },
  '/api/admin/catalog-search': { items: [{ kind: 'song', id: 'abc123', name: 'Kesariya', subtitle: 'Arijit Singh', image: '' }, { kind: 'artist', id: 'ar1', name: 'Anirudh Ravichander', subtitle: '' }] },
  '/api/admin/enginetest': { ok: true, model: 'default', ms: 420, text: 'pong', status: 200 },
  '/api/admin/seo': { configured: true, total: 12345, sampled: 2000, counts: [{ type: 'song', plural: 'Songs', count: 10000, pages: 2 }, { type: 'artist', plural: 'Artists', count: 2345, pages: 1 }], languages: [{ lang: 'telugu', n: 900 }, { lang: 'hindi', n: 700 }], addedByDay: [{ day: iso(48).slice(0, 10), n: 40 }, { day: iso(24).slice(0, 10), n: 55 }], newest: [{ type: 'song', name: 'Srivalli', lang: 'telugu', key: 'srivalli-x', added_at: iso(1) }], sitemap: { status: 200, entries: 3, ms: 120, bytes: 900 } },
  '/api/admin/edge': { origin: 'https://www.example.test', checkedAt: iso(0), healthy: true, problems: 0, shell: { status: 200, ms: 80, ok: true, bytes: 4000, cacheStatus: 'HIT', build: '5.13.0' }, assets: [{ path: '/assets/index-abc.js', kind: 'script', ok: true, status: 200, contentType: 'application/javascript', ms: 30 }], endpoints: [{ name: 'Version', method: 'GET', path: '/api/version', ok: true, status: 200, ms: 40 }, { name: 'Preview CORS', method: 'OPTIONS', path: '/api/preview', ok: false, status: 500, ms: 90, note: 'expected 204' }] },
  '/api/admin/releases': { configured: true, release: { tag: 'v5.12.0', name: 'v5.12.0', assets: [{ name: 'app.apk' }], notes: 'Ten new features' }, runs: [{ number: 101, name: 'Deploy', title: 'v5.12.0', conclusion: 'success', status: 'completed', branch: 'main', sha: 'abc1234', event: 'push', started: iso(3), url: 'https://example.test/run' }, { number: 100, name: 'Deploy', title: 'fix', conclusion: 'failure', status: 'completed', branch: 'main', sha: 'def5678', event: 'push', started: iso(10), url: 'https://example.test/run2' }], commits: [{ sha: 'abc1234', message: 'v5.12.0: ten new listening features', author: 'dev', at: iso(3) }], live: { version: '5.12.0' } },
  '/api/admin/tables': { configured: true, totalRows: 54321, tables: [{ name: 'vinax_events', total: 50000, last24h: 1200, newestAt: iso(0.1), ageMin: 6, note: 'Play and page events' }, { name: 'vinax_ai_events', total: 4321, last24h: 0, newestAt: iso(30), ageMin: 1800, note: 'AI calls' }] },
  '/api/admin/audit': { items: [{ kind: 'appconfig', text: 'Updated flags', at: iso(2) }, { kind: 'block', text: 'Blocked song x', at: iso(20) }] },
  '/api/admin/usage': { configured: true, days: 7, sampled: 4200, byType: [{ type: 'play', n: 2000, devices: 300 }, { type: 'search', n: 800, devices: 200 }, { type: 'favorite', n: 120, devices: 80 }], byPlatform: [{ platform: 'android', n: 2500 }, { platform: 'web', n: 1700 }], heatmap: heat, peak: { day: 5, hour: 21, n: 10 } },
  '/api/admin/funnel': { configured: true, days: 7, sampled: 4200, steps: [{ id: 'open', label: 'Opened the app', devices: 400, pct: 100 }, { id: 'register', label: 'Chose a name', devices: 210, pct: 52 }, { id: 'play', label: 'Played a song', devices: 300, pct: 75 }, { id: 'complete', label: 'Finished a song', devices: 220, pct: 55 }, { id: 'favorite', label: 'Liked a song', devices: 80, pct: 20 }, { id: 'search', label: 'Searched', devices: 200, pct: 50 }, { id: 'share', label: 'Shared', devices: 12, pct: 3 }] },
  '/api/admin/songstats': { configured: true, days: 30, q: 'kesariya', match: { id: 'abc123', title: 'Kesariya', artist: 'Arijit Singh', image: '' }, candidates: [{ id: 'x1', title: 'Kesariya (Dance Mix)', artist: 'Arijit Singh', image: '', n: 4 }], totals: { plays: 120, skips: 14, completes: 90, favorites: 20, listeners: 70 }, byDay: [{ day: iso(48).slice(0, 10), plays: 50, skips: 5 }, { day: iso(24).slice(0, 10), plays: 70, skips: 9 }], countries: [{ country: 'IN', n: 100 }, { country: 'US', n: 20 }], platforms: [{ platform: 'android', n: 90 }, { platform: 'web', n: 30 }], skipRate: 12 },
  '/api/admin/skips': { configured: true, days: 7, min: 5, sampled: 4000, items: [{ id: 's1', title: 'Skippy Song', artist: 'Someone', image: '', plays: 40, skips: 28, rate: 70 }] },
  '/api/admin/cron': { configured: true, checkedAt: iso(0), jobs: [{ id: 'ai-daily-push', label: 'AI daily push', schedule: '5x a day', note: 'writes an ai-push event', lastAt: iso(3), ageMin: 180, ok: true, maxAgeMin: 540, readable: true }, { id: 'seo-crawl', label: 'SEO crawl', schedule: 'hourly', note: 'grows corpus', lastAt: iso(9), ageMin: 540, ok: false, maxAgeMin: 180, readable: true }] },
  '/api/admin/envcheck': { checkedAt: iso(0), items: [{ name: 'SUPABASE_URL', group: 'Data', required: true, note: 'store', set: true }, { name: 'CRON_SECRET', group: 'Cron', required: true, note: 'cron', set: false }, { name: 'BRAVE_API_KEY', group: 'AI', required: false, note: 'search', set: false }], missingRequired: ['CRON_SECRET'] },
  '/api/admin/query': { configured: true, table: 'vinax_events', columns: ['created_at', 'type', 'platform'], rows: [{ created_at: iso(1), type: 'play', platform: 'web' }, { created_at: iso(2), type: 'search', platform: 'android' }], truncated: false },
  '/api/admin/content': { blocked: [{ song_id: 'b1', song_title: 'Blocked One', reason: 'test' }], topSongs: [] },
  '/api/status': { generatedAt: iso(0), windowDays: 90, overall: 'operational', components: [{ id: 'website', name: 'Website', status: 'up', latencyMs: 120, checkedAt: iso(0.2), uptime90: 99.98, days: Array.from({ length: 30 }, (_, i) => ({ day: iso(24 * i).slice(0, 10), up: i === 5 ? 40 : 48, total: 48 })) }, { id: 'api', name: 'API', status: 'down', latencyMs: null, checkedAt: iso(2), uptime90: 98.1, days: [] }] },
  '/api/trending-searches': { queries: ['Kesariya', 'Naatu Naatu', 'Srivalli'] },
  '/api/site-mode': { mode: 'live' },
};

/**
 * Content probes per panel, from the v5.13/v5.15 fixtures above. Panels not
 * listed only need to render something. Checked against innerText and
 * innerHTML (textarea values only show in the latter).
 */
const PROBES: Record<string, RegExp> = {
  retention: /weekly cohorts/i,
  dataquality: /signals[\s\S]*ai success/i,
  catalog: /catalog|search/i,
  engineprobe: /probe|engine/i,
  seo: /urls in corpus[\s\S]*srivalli/i,
  edge: /edge is healthy[\s\S]*preview cors/i,
  releases: /v5\.12\.0[\s\S]*workflow runs[\s\S]*recent commits/i,
  tables: /rows across tables[\s\S]*vinax_events/i,
  audit: /audit trail[\s\S]*updated flags/i,
  flags: /codeRun|code run|listenTogether|listen together/i,
  runbook: /worker 5xx spike/i,
  backup: /download backup/i,
  trendpins: /kesariya[\s\S]*what listeners see now/i,
  statusnote: /all systems normal/i,
  usage: /what listeners do[\s\S]*play/i,
  heatmap: /busiest hour[\s\S]*sat 21:00/i,
  funnel: /opened the app[\s\S]*finished a song/i,
  songstats: /song drilldown/i,
  skips: /skippy song[\s\S]*70%/i,
  synonyms: /arr = a\. r\. rahman/i,
  sources: /vinax music api/i,
  langorder: /telugu/i,
  blocklistio: /download blocklist/i,
  aistarters: /suggest 5 \{lang\} songs/i,
  aiquick: /songs \| suggest songs for/i,
  airules: /diwali mixes/i,
  cron: /ai daily push[\s\S]*overdue/i,
  statushist: /90-day uptime[\s\S]*website/i,
  envcheck: /missing required[\s\S]*cron_secret/i,
  query: /query console/i,
  relnotes: /releases with cards[\s\S]*v?\d+\.\d+\.\d+/i,
  maintwin: /current window/i,
  minver: /5140/,
  broadcast: /hello everyone/i,
  greeting: /festival week/i,
  faq: /how do i download\?/i,
  announce: /announcement composer/i,
  pins: /pinned tools/i,
  festivals: /festivals, each its own theme/i,
};

interface Backend {
  cfg: Record<string, unknown>;
  posted: string[];
}

async function login(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem('vinax_admin_token', 'test-token');
    localStorage.removeItem('vinax_admin_sec');
    localStorage.removeItem('vinax_admin_pins');
  });
}

/** Abort everything non-local; answer every /api call from the fixtures. */
async function mockBackend(page: Page): Promise<Backend> {
  const backend: Backend = { cfg: initialConfig(), posted: [] };
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    const p = url.pathname;
    if (!p.startsWith('/api/')) return route.continue();
    let body: unknown;
    if (p === '/api/admin/appconfig') {
      if (req.method() === 'POST') {
        const b = JSON.parse(req.postData() || '{}') as { key: string; value: unknown };
        backend.cfg[b.key] = b.value;
        backend.posted.push(b.key);
        body = { ok: true };
      } else {
        const k = url.searchParams.get('key') ?? '';
        body = { configured: k in backend.cfg, value: backend.cfg[k] ?? null, updated_at: iso(5) };
      }
    } else if (p === '/api/appconfig') {
      const k = url.searchParams.get('key') ?? '';
      body = { [k]: backend.cfg[k] ?? null };
    } else if (req.method() === 'POST') {
      backend.posted.push(p);
      body = { ok: true, sent: 3 };
    } else {
      body = MOCK[p] ?? { ok: true, items: [] };
    }
    return route.fulfill({ json: body });
  });
  return backend;
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/net::|Failed to load resource|ERR_FAILED/.test(t)) errors.push(`console: ${t.slice(0, 200)}`);
  });
  return errors;
}

const viewText = (page: Page): Promise<string> => page.evaluate(() => document.getElementById('view')?.innerText ?? '');
const viewHtml = (page: Page): Promise<string> => page.evaluate(() => document.getElementById('view')?.innerHTML ?? '');

async function openSection(page: Page, sec: string): Promise<void> {
  // DOM click: nav groups can be collapsed, and the panel switch is what matters.
  const ok = await page.evaluate((s) => {
    const b = document.querySelector<HTMLButtonElement>(`#nav button[data-sec="${s}"]`);
    b?.click();
    return !!b;
  }, sec);
  expect(ok, `nav button for ${sec}`).toBe(true);
}

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/admin/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#login')).toBeHidden();
}

test('every nav section renders a panel with no page or console errors', async ({ page }) => {
  await login(page);
  await mockBackend(page);
  const errors = collectErrors(page);
  await openAdmin(page);

  const sections = await page.$$eval('#nav button[data-sec]', (els) => els.map((e) => e.getAttribute('data-sec') ?? ''));
  expect(sections.length, 'nav sections present').toBeGreaterThanOrEqual(64);

  const failures: string[] = [];
  for (const sec of sections) {
    await openSection(page, sec);
    const probe = PROBES[sec];
    const deadline = Date.now() + 6_000;
    let ok = false;
    let text = '';
    while (!ok && Date.now() < deadline) {
      text = await viewText(page);
      const html = probe ? await viewHtml(page) : '';
      ok = probe ? probe.test(text) || probe.test(html) : /\S/.test(text) && !/^\s*loading…?\s*$/i.test(text);
      if (!ok) await page.waitForTimeout(150);
    }
    if (!ok) failures.push(`${sec}: ${probe ? `no match for ${probe}` : 'empty panel'} — "${text.replace(/\s+/g, ' ').slice(0, 160)}"`);
  }
  expect(failures, 'panels that did not render their content').toEqual([]);
  expect(errors).toEqual([]);
});

test('catalog search, song drilldown and query console run against the API', async ({ page }) => {
  await login(page);
  await mockBackend(page);
  const errors = collectErrors(page);
  await openAdmin(page);

  await openSection(page, 'catalog');
  const q = page.locator('#cat-q');
  await expect(q).toBeVisible();
  await q.fill('kesariya');
  await q.press('Enter');
  await expect.poll(() => viewText(page)).toMatch(/kesariya[\s\S]*abc123/i);

  await openSection(page, 'songstats');
  await page.locator('#ss-q').fill('kesariya');
  await page.locator('#ss-go').click();
  await expect.poll(() => viewText(page)).toMatch(/kesariya[\s\S]*skip rate/i);

  await openSection(page, 'query');
  await page.locator('#qc-run').click();
  await expect.poll(() => viewText(page)).toMatch(/2 rows/i);
  expect(await viewText(page)).toMatch(/created_at/i);
  expect(errors).toEqual([]);
});

test('synonyms and broadcast publish through appconfig; pinning a tool adds it to the nav', async ({ page }) => {
  await login(page);
  const backend = await mockBackend(page);
  const errors = collectErrors(page);
  await openAdmin(page);

  await openSection(page, 'synonyms');
  const syn = page.locator('#syn-text');
  await expect(syn).toBeVisible();
  await syn.fill('arr = A. R. Rahman\nssmb = Mahesh Babu');
  await page.locator('#synonyms-save').click();
  await expect.poll(() => backend.cfg['search-synonyms']).toEqual({ arr: 'A. R. Rahman', ssmb: 'Mahesh Babu' });
  await expect(page.locator('#synonyms-out')).toContainText(/published/i);

  await openSection(page, 'broadcast');
  await expect(page.locator('#bc-text')).toBeVisible();
  await page.locator('#bc-text').fill('New: Listen Later');
  await page.locator('#bc-link').fill('/later');
  await page.locator('#broadcast-save').click();
  await expect
    .poll(() => backend.cfg.broadcast as { id?: string; text?: string; link?: string } | undefined)
    .toMatchObject({ text: 'New: Listen Later', link: '/later' });
  expect((backend.cfg.broadcast as { id: string }).id).toMatch(/^b/);
  expect(backend.posted).toEqual(expect.arrayContaining(['search-synonyms', 'broadcast']));

  await openSection(page, 'pins');
  await expect(page.locator('[data-pintoggle="cron"]')).toBeAttached();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-pintoggle="cron"]')?.click());
  await expect(page.locator('#nav-pins button[data-sec="cron"]')).toBeAttached();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vinax_admin_pins') ?? '[]'))).toEqual(['cron']);
  expect(errors).toEqual([]);
});

test('home presets stay in draft until publication, with an accurate preview', async ({ page }) => {
  await login(page);
  const backend = await mockBackend(page);
  const errors = collectErrors(page);
  await openAdmin(page);
  await openSection(page, 'homescreen');
  await expect(page.locator('.hs-preview')).toBeVisible();
  await page.locator('[data-preset="focused"]').click();
  await expect(page.locator('.hs-preview-row')).toHaveCount(4);
  expect(backend.posted).not.toContain('home-config');
  await expect.poll(() => viewText(page)).toMatch(/unpublished changes/i);
  await page.locator('#hs-save').click();
  await expect.poll(() => backend.posted).toContain('home-config');
  await expect.poll(() => viewText(page)).toMatch(/matches published layout/i);
  const cfg = backend.cfg['home-config'] as { blocks: { id: string; enabled: boolean }[] };
  expect(cfg.blocks.filter((x) => x.enabled).map((x) => x.id)).toEqual(['quick', 'personal', 'loved', 'daypicks']);
  await page.locator('main').evaluate((el) => { (el as HTMLElement).style.scrollBehavior = 'auto'; el.scrollTop = 0; });
  await page.screenshot({ path: 'test-results/admin-studio.png', fullPage: true });
  expect(errors).toEqual([]);
});
