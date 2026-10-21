/**
 * Owner console (13.8 rebuild) — Notifications, VinaX AI and Recommendations
 * pages (/admin/pages/notify.js, ai.js, recs.js).
 *
 * The console is static files; every /api call is answered from the fixtures
 * below and all non-localhost network is aborted. The session is seeded with
 * an owner token. Each test checks that panels render real content with no
 * page or console errors and no "undefined" / "NaN" / "[object Object]", that
 * a freshly wiped (empty) database shows friendly empty states, and that each
 * write sends exactly the body the server's contract expects.
 */
import { test, expect, type Page } from './support/test';

const NOW = Date.now();
const iso = (minAgo: number): string => new Date(NOW - minAgo * 60_000).toISOString();
const day = (i: number): string => new Date(NOW - i * 864e5).toISOString().slice(0, 10);
const FEATURES = ['dj', 'curate-metadata', 'curate-ranking', 'curate-home', 'curate-shelves', 'playlist', 'vinaxai', 'assistant', 'tts', 'lyrics', 'image', 'embed', 'search', 'transcribe', 'music', 'web-search', 'deep-research'];
const SSE = ['{"meta":{"model":"meta/llama-3.3-70b-instruct","name":"Llama 3.3 70B","provider":"nvidia","lane":"chat"}}', '{"delta":"Hello from the lab."}', '{"done":true,"chars":19}'].map((l) => `data: ${l}\n\n`).join('');

type Json = Record<string, unknown>;
const rate = (k: number, n: number): Json => ({ k, n, rate: n ? k / n : null, low: n ? Math.max(0, k / n - 0.05) : null, high: n ? Math.min(1, k / n + 0.05) : null });
const group = (key: string, calls: number, fails: number): Json => ({
  key, calls, failures: fails, failureRate: rate(fails, calls), latencyMs: { n: calls, p50: 820, p95: 2400 }, hops: 3,
  blocked: { disabled: 1, overBudget: 0 }, tokens: { prompt: 12000, completion: 3400, reportedCalls: calls },
  cost: { usd: 0.0123, pricedCalls: calls, unpricedCalls: 0, unreportedCalls: 0, complete: true },
});
const stats = (key: string, devices: number): Json => ({
  key, devices, continuations: 80, exposures: 300, withheld: false,
  served: { songs: 320, latencyMs: { n: 80, p50: 450, p50Low: 440, p50High: 460, p95: 900 }, fallback: { ...rate(6, 80), byReason: { ai_timeout: 6 } }, languageViolations: { songs: 3, rate: rate(3, 320) }, discovery: rate(60, 320), diversity: { n: 80, mean: 3.4 }, relaxed: {} },
  outcomes: { heardSec: { n: 300, p50: 142, p50Low: 137, p50High: 147, p95: 240 }, completion: rate(180, 300), skip: rate(90, 300), earlySkip: rate(40, 300), likes: rate(12, 300), repeats: rate(5, 300) },
});
const WEIGHTS = [['mood', 0.16], ['vibe', 0.1], ['novelty', 0.16]].map(([key, d]) => ({ key, default: d, min: (d as number) / 2, max: (d as number) * 2, touches: ['Next song'] }));
const record = (version: number, overrides: Json, rollout: Json): Json => ({ version, overrides, rollout, note: `v${version}`, evaluation: null, updatedAt: iso(60 * version), updatedBy: 'owner' });
const EXPERIMENTS = [{ key: 'novelty-boost', name: 'More new artists', active: true, variants: [{ name: 'control', pct: 50 }, { name: 'boost', pct: 50 }], metrics: [{ variant: 'control', pct: 50, devices: 30, playsPerDevice: 12.4, skipRatePct: 22.5 }, { variant: 'boost', pct: 50, devices: 28, playsPerDevice: 13.1, skipRatePct: null }], created_at: iso(5000) }];
const ANNOUNCED = new Date(NOW - 3 * 3600e3).toISOString();

function fixtures(full: boolean): Record<string, unknown> {
  const pushEnv = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'FCM_SERVICE_ACCOUNT'].map((name) => ({ name, group: 'Push', required: false, note: name, set: full }));
  return {
    '/api/version': { version: '13.8.0' },
    '/api/admin/envcheck': { items: pushEnv, missingRequired: [], checkedAt: iso(0) },
    '/api/admin/push': full
      ? { configured: true, subscribers: 42, fcm: 17, geo: { countries: [{ key: 'IN', count: 50 }], regions: [{ key: 'Telangana', count: 30, country: 'IN' }], cities: [{ key: 'Hyderabad', count: 25, region: 'Telangana', country: 'IN' }] } }
      : { configured: false, subscribers: 0, fcm: 0, geo: { countries: [], regions: [], cities: [] } },
    '/api/admin/notifylog': full ? { configured: true, rows: [
      { type: 'push-receipt', message: JSON.stringify({ ts: NOW - 3 * 3600e3, title: 'New this week', audience: 'everyone', web: { total: 42, sent: 40, gone: 1, failed: {} }, fcm: 16 }), created_at: iso(170), city: null, region: null, country: null, song_title: null, language: null },
      { type: 'announcement', message: JSON.stringify({ title: 'New this week', body: 'Fresh Telugu hits are in.', link: '/trending', ts: NOW - 3 * 3600e3 }), created_at: ANNOUNCED, city: null, region: null, country: null, song_title: null, language: null },
      { type: 'song-push', message: 'queued|te:Butta Bomma', created_at: iso(1200), city: null, region: null, country: null, song_title: null, language: null },
    ] } : { configured: true, rows: [] },
    '/api/admin/fcmcheck': full ? { configured: true, project: 'vinax-music', token: true, fcm: 'ok', detail: 'INVALID_ARGUMENT', devices: 20 } : { configured: false, project: null, token: false, fcm: 'skipped', detail: null, devices: 0 },
    '/api/admin/ai': { configured: true, days: 7, metrics: full ? {
      total: 240, ok: 228, fail: 12, avg_latency_ms: 1320, by_feature: [{ feature: 'vinaxai', total: 240, ok: 228, fail: 12 }],
      by_model: [{ model: 'meta/llama-3.3-70b-instruct @chat', count: 240 }], by_client: [{ client: 'web', count: 240 }], by_error: [{ error: 'timeout', count: 12 }],
      by_day: [{ day: day(0), total: 240, ok: 228, fail: 12 }],
      recent: [{ ts: new Date(NOW - 120e3).toISOString().slice(0, 19).replace('T', ' '), feature: 'vinaxai', model: 'meta/llama-3.3-70b-instruct @chat', ok: true, status: 200, error: null, client: 'web', latency_ms: 980 }],
    } : { total: 0, ok: 0, fail: 0, avg_latency_ms: 0, by_feature: [], by_model: [], by_client: [], by_error: [], by_day: [], recent: [] } },
    '/api/admin/aiops': {
      configured: true, days: 7, sampled: full ? 240 : 0, truncated: false, tokenColumns: true,
      totals: group('all', full ? 240 : 0, full ? 12 : 0), byFeature: full ? [group('vinaxai', 240, 12)] : [], byLane: full ? [group('chat', 240, 12)] : [],
      today: { day: day(0), calls: full ? 140 : 0, tokens: 0, cost: { usd: null, pricedCalls: 0, unpricedCalls: 0, unreportedCalls: 0, complete: true } },
      controls: { read: 'ok', published: false, value: null, rowUpdatedAt: null },
      budget: { day: day(0), tokenCap: null, tokensToday: 0, tokenPct: null, costCapUsd: null, costTodayUsd: null, costComplete: true, costPct: null, state: 'no_caps' },
      prices: { read: 'ok', configured: full }, controlFeatures: FEATURES,
    },
    '/api/admin/ailab': { configured: true, hours: 24, sampled: full ? 90 : 0, capped: false, lanes: full ? [{ lane: 'chat', calls: 90, okPct: 97, p50: 800, p95: 2100, p99: 4000, hops: 2, emptyStreams: 1, authErrors: 0 }] : [] },
    '/api/aimodels': { fetchedAt: iso(0), providers: ['nvidia', 'openrouter', 'groq', 'gemini', 'cloudflare'].map((id) => ({ id, label: id, configured: full && id !== 'groq', models: full && id === 'nvidia' ? [{ id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', maker: 'meta', context: 128000, vision: false }] : [], media: [], tools: [] })), features: { image: false, speech: false, transcription: false, music: false, code: false, web: false } },
    '/api/admin/aicost': full
      ? { configured: true, days: 7, sampled: 240, tokensTotal: { prompt: 120000, completion: 34000 }, byModel: [{ model: 'meta/llama-3.3-70b-instruct', calls: 140, prompt: 80000, completion: 20000, cost: 0.0125, priced: true }, { model: 'gemini-2.0-flash', calls: 100, prompt: 40000, completion: 14000, cost: 0, priced: false }], byDay: [{ day: day(0), prompt: 120000, completion: 34000, cost: 0.0125 }], unpriced: false, prices: { 'meta/': { in: 0.1, out: 0.1 } } }
      : { configured: true, days: 7, sampled: 0, tokensTotal: { prompt: 0, completion: 0 }, byModel: [], byDay: [], unpriced: true, prices: {} },
    '/api/admin/musicapi': { checkedAt: iso(0), mirrors: [{ id: 'vinax-cat', label: 'x', base: 'x', ok: true, status: 200, ms: 320, songs: 1, note: null }] },
    '/api/admin/recquality': full
      ? { configured: true, provisioned: true, scope: 'opt-in', days: 7, sampled: 900, truncated: false, minDevices: 3, earlySkipSec: 30, devices: 24, overall: stats('all', 24), byAlg: [stats('mix-v3', 24)], byPicker: [stats('local', 24)], byVariant: [stats('(no experiment)', 24)] }
      : { configured: true, provisioned: true, scope: 'opt-in', days: 7, sampled: 0, truncated: false, minDevices: 3, earlySkipSec: 30, devices: 0, overall: { key: 'all', devices: 0, continuations: 0, exposures: 0, withheld: true, served: null, outcomes: null }, byAlg: [], byPicker: [], byVariant: [] },
    '/api/admin/recconfig': {
      configured: true, version: full ? 2 : 0, live: full,
      current: full ? record(2, { mood: 0.2 }, { mode: 'all' }) : null,
      history: full ? [record(2, { mood: 0.2 }, { mode: 'all' }), record(1, { mood: 0.18 }, { mode: 'off' })] : [],
      weights: WEIGHTS, range: { minFactor: 0.5, maxFactor: 2 }, baseVersion: '1.3.0', evalCommand: 'node frontend/scripts/eval-recs.mjs',
      experiments: full ? EXPERIMENTS.map(({ key, name, active, variants }) => ({ key, name, active, variants })) : [], experimentsRead: 'ok',
    },
    '/api/admin/experiments': full ? { configured: true, experiments: EXPERIMENTS, sampledEvents: 4200 } : { configured: true, experiments: [] },
  };
}

interface Backend { posts: Array<{ path: string; body: Json }>; cfg: Record<string, unknown> }

async function open(page: Page, full: boolean): Promise<Backend> {
  const backend: Backend = { posts: [], cfg: full ? { 'ai-controls': { emergencyOff: false, features: { music: false }, dailyTokenCap: null, dailyCostCapUsd: null, updatedAt: iso(300), updatedBy: 'owner' }, 'ai-starters': ['Suggest 5 {lang} songs for a road trip'] } : {} };
  const fx = fixtures(full);
  await page.addInitScript(() => {
    sessionStorage.setItem('vinax_admin_token', 'test-token');
    localStorage.setItem('vinax_admin_theme', 'dark');
  });
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    const p = url.pathname;
    if (!p.startsWith('/api/')) return route.continue();
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}') as Json;
      backend.posts.push({ path: p, body });
      if (p === '/api/admin/appconfig') { backend.cfg[body.key as string] = body.value; return route.fulfill({ json: { ok: true } }); }
      if (p === '/api/admin/push') return route.fulfill({ json: body.dryRun ? { dryRun: true, web: 12, fcm: 4, audience: 'everyone' } : { ok: true, total: 42, sent: 40, gone: 1, failed: {}, fcm: 17, fcmFailed: {}, target: 'everyone' } });
      if (p === '/api/admin/ailab') return route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: SSE });
      if (p === '/api/admin/recconfig') return route.fulfill({ json: { ok: true, record: { version: 3 }, clamped: [], historySaved: true } });
      return route.fulfill({ json: { ok: true } });
    }
    if (p === '/api/admin/appconfig') {
      const k = url.searchParams.get('key') ?? '';
      return route.fulfill({ json: { configured: true, value: backend.cfg[k] ?? null, updated_at: null } });
    }
    if (p === '/api/admin/enginetest') return route.fulfill({ json: { key: url.searchParams.get('key'), provider: 'nvidia', model: 'm', status: 200, ms: 500, head: 'OK', media: [], tools: [] } });
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

const lastPost = (b: Backend, path: string): Json | undefined => [...b.posts].reverse().find((x) => x.path === path)?.body;
const confirmDialog = (page: Page) => page.locator('.modal-foot button').last().click();

const ROUTES: Array<[string, RegExp, RegExp]> = [
  ['notify/send', /Browser subscribers[\s\S]*42/, /Push is not set up, so nothing can be sent/],
  ['notify/history', /New this week[\s\S]*40 of 42 browsers/, /Nothing sent yet/],
  ['notify/audience', /Android push works/, /Android push is not set up/],
  ['ai/usage', /AI calls[\s\S]*240[\s\S]*Provider lanes/, /No AI calls in the last 7 days/],
  ['ai/controls', /Music clip generation[\s\S]*Off/, /Nothing published yet: every AI feature is on/],
  ['ai/cost', /Prompt tokens[\s\S]*120K[\s\S]*No price/, /No prices yet/],
  ['ai/lab', /Providers[\s\S]*Chat bench/, /No media models available/],
  ['ai/probe', /Provider keys[\s\S]*Music catalogue sources/, /No probes yet/],
  ['ai/content', /Starter prompts[\s\S]*Published[\s\S]*1 of 24/, /No custom starter prompts/],
  ['recs/quality', /Continuations[\s\S]*80[\s\S]*By algorithm/, /No recommendation data yet/],
  ['recs/tuning', /Published — version 2/, /Nothing published yet/],
  ['recs/experiments', /More new artists[\s\S]*Running/, /No experiments yet/],
];

test('every tab of Notifications, VinaX AI and Recommendations renders with data', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, true);
  for (const [route, probe] of ROUTES) expect(await visit(page, route), route).toMatch(probe);
  expect(errors).toEqual([]);
});

test('a freshly wiped database shows friendly empty states, and missing push secrets are named', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, false);
  for (const [route, , empty] of ROUTES) expect(await visit(page, route), route).toMatch(empty);
  expect(errors).toEqual([]);
});

test('notifications: count recipients, send to everyone after confirming, remove from the log', async ({ page }) => {
  const errors = collectErrors(page);
  const backend = await open(page, true);
  await visit(page, 'notify/send');
  await page.getByLabel('Message').fill('Fresh Telugu hits are in.');
  await page.getByLabel('Link').fill('/trending');
  await page.getByRole('button', { name: 'Count recipients' }).click();
  await expect(page.locator('#pageBody')).toContainText('Would reach 12 browsers and 4 Android devices');
  expect(lastPost(backend, '/api/admin/push')).toEqual({ title: 'VinaX', body: 'Fresh Telugu hits are in.', link: '/trending', dryRun: true });

  await page.getByRole('radio', { name: 'A segment' }).click();
  await page.getByLabel('Country').selectOption('IN');
  await page.getByLabel('Language').fill('te');
  await page.getByRole('button', { name: 'Count recipients' }).click();
  await expect.poll(() => lastPost(backend, '/api/admin/push')).toEqual({ title: 'VinaX', body: 'Fresh Telugu hits are in.', link: '/trending', filter: { country: 'IN', langPrefix: 'te' }, dryRun: true });

  await page.getByRole('radio', { name: 'Everyone' }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.modal')).toContainText('Send to everyone?');
  await confirmDialog(page);
  await expect(page.locator('#pageBody')).toContainText('Browsers reached');
  const sent = lastPost(backend, '/api/admin/push') as Json;
  expect(sent).toMatchObject({ title: 'VinaX', body: 'Fresh Telugu hits are in.', link: '/trending' });
  expect(sent.dryRun).toBeUndefined();
  expect(sent.filter).toBeUndefined();
  expect(typeof sent.dedupe_key).toBe('string');

  await visit(page, 'notify/history');
  await page.getByRole('button', { name: /^Remove “New this week”/ }).click();
  await confirmDialog(page);
  await expect.poll(() => lastPost(backend, '/api/admin/notifylog')).toEqual({ action: 'retract', created_at: ANNOUNCED });
  expect(errors).toEqual([]);
});

test('VinaX AI: controls publish every feature switch, prices, lab bench and assistant content', async ({ page }) => {
  const errors = collectErrors(page);
  const backend = await open(page, true);

  await visit(page, 'ai/controls');
  await page.getByRole('switch', { name: 'Image generation' }).uncheck({ force: true });
  await page.getByLabel('Token cap (prompt + completion)').fill('500000');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect.poll(() => (lastPost(backend, '/api/admin/appconfig') as Json | undefined)?.key).toBe('ai-controls');
  const controls = (lastPost(backend, '/api/admin/appconfig') as { value: { features: Record<string, boolean> } & Json }).value;
  expect(Object.keys(controls.features).sort()).toEqual([...FEATURES].sort());
  expect(controls.features).toMatchObject({ image: false, music: false, transcribe: true, vinaxai: true });
  expect(controls).toMatchObject({ emergencyOff: false, dailyTokenCap: 500000, dailyCostCapUsd: null });

  await visit(page, 'ai/cost');
  await page.getByRole('button', { name: 'Add 1 unpriced model at $0' }).click();
  await page.getByRole('button', { name: 'Publish prices' }).click();
  await expect.poll(() => lastPost(backend, '/api/admin/appconfig')).toEqual({ key: 'ai-prices', value: { 'meta/': { in: 0.1, out: 0.1 }, 'gemini-2.0-flash': { in: 0, out: 0 } } });

  await visit(page, 'ai/lab');
  await page.getByRole('button', { name: 'Run', exact: true }).first().click();
  await expect(page.locator('#pageBody')).toContainText('Hello from the lab.');
  expect(lastPost(backend, '/api/admin/ailab')).toEqual({ provider: 'nvidia', messages: [{ role: 'user', content: 'Suggest three upbeat Telugu songs for a morning walk, one line each.' }], maxTokens: 300 });

  await visit(page, 'ai/content');
  const starters = page.locator('#pageBody .card').first();
  await starters.getByRole('button', { name: 'Add a prompt' }).click();
  await starters.locator('input').nth(1).fill('Play something calm for {lang} evenings');
  await starters.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect.poll(() => lastPost(backend, '/api/admin/appconfig')).toEqual({ key: 'ai-starters', value: ['Suggest 5 {lang} songs for a road trip', 'Play something calm for {lang} evenings'] });
  await visit(page, 'ai/content');
  await page.locator('#pageBody .card').first().getByRole('button', { name: 'Clear' }).click();
  await confirmDialog(page);
  await expect.poll(() => lastPost(backend, '/api/admin/appconfig')).toEqual({ key: 'ai-starters', value: null });
  expect(errors).toEqual([]);
});

test('Recommendations: publish with expectedVersion, roll back, and manage experiments', async ({ page }) => {
  const errors = collectErrors(page);
  const backend = await open(page, true);

  await visit(page, 'recs/tuning');
  await page.getByLabel('Proposed vibe').fill('0.15');
  await page.getByLabel('Rollout').selectOption('off');
  await page.getByLabel('Note').fill('More vibe');
  await page.getByLabel('Published by').fill('Owner');
  await page.getByRole('button', { name: 'Publish version 3' }).click();
  await expect.poll(() => lastPost(backend, '/api/admin/recconfig')).toEqual({ expectedVersion: 2, overrides: { mood: 0.2, vibe: 0.15 }, rollout: { mode: 'off' }, note: 'More vibe', evaluation: null, by: 'Owner' });

  await visit(page, 'recs/tuning');
  await page.getByRole('button', { name: 'Roll back to version 1' }).click();
  await confirmDialog(page);
  await expect.poll(() => lastPost(backend, '/api/admin/recconfig')).toEqual({ action: 'rollback', toVersion: 1, expectedVersion: 2, by: 'Owner' });

  await visit(page, 'recs/experiments');
  await page.getByRole('button', { name: 'New experiment' }).click();
  await page.locator('.modal').getByLabel('Key', { exact: true }).fill('calm-mix');
  await page.locator('.modal').getByLabel('Variant 1 share in percent').fill('40');
  await page.locator('.modal').getByLabel('Variant 2 share in percent').fill('40');
  await confirmDialog(page);
  await expect.poll(() => lastPost(backend, '/api/admin/experiments')).toEqual({ action: 'save', key: 'calm-mix', variants: [{ name: 'control', pct: 40 }, { name: 'treatment', pct: 40 }], active: false });

  await visit(page, 'recs/experiments');
  await page.getByRole('button', { name: 'Pause novelty-boost' }).click();
  await expect.poll(() => lastPost(backend, '/api/admin/experiments')).toEqual({ action: 'toggle', key: 'novelty-boost', active: false });

  await visit(page, 'recs/experiments');
  await page.getByRole('button', { name: 'Delete novelty-boost' }).click();
  await page.locator('.modal input').fill('novelty-boost');
  await confirmDialog(page);
  await expect.poll(() => lastPost(backend, '/api/admin/experiments')).toEqual({ action: 'delete', key: 'novelty-boost' });
  expect(errors).toEqual([]);
});
