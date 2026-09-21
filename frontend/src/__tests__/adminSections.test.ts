// @vitest-environment jsdom
/**
 * 7.2.0 — owner console section modules (public/admin/sections/*.js).
 *
 * Loads the real registry and the real section files into a DOM, hands them
 * helpers built from the console's own `esc` / `html` (extracted from
 * app.js, so the test cannot drift from what the console runs), and feeds
 * them server answers whose labels carry markup. Every such label must come
 * out as TEXT: no element, handler or javascript: link may be created from
 * data. Also pins the behaviour the owner relies on: opt-in scope and sample
 * sizes on Recommendation Quality, confirmation before AI is switched off,
 * and the unvalidated label and 409 handling on Recommendation Tuning.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN = join(__dirname, '..', '..', 'public', 'admin');
const read = (rel: string): string => readFileSync(join(ADMIN, rel), 'utf8');
const HOSTILE = '<img src=x onerror=alert(1)>';

/** Cut one `function name(…) { … }` out of app.js by brace matching. */
function extractFunction(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`not found: ${signature}`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced: ${signature}`);
}

const appJs = read('app.js');
const { esc, html } = new Function(
  `${extractFunction(appJs, 'function esc(v)')}\n${extractFunction(appJs, 'function html(strings, ...values)')}\nreturn { esc: esc, html: html };`,
)() as { esc: (v: unknown) => string; html: (s: TemplateStringsArray, ...v: unknown[]) => string };

interface Section { local?: boolean; load: (h: Helpers) => unknown }
interface Registry { get(key: string): Section | null; keys(): string[] }
interface Helpers {
  api: ReturnType<typeof vi.fn>;
  apiMemo: ReturnType<typeof vi.fn>;
  postApi: ReturnType<typeof vi.fn>;
  esc: typeof esc;
  html: typeof html;
  $: (id: string) => HTMLElement | null;
  view: (markup: string) => void;
  fail: ReturnType<typeof vi.fn>;
  stamp: ReturnType<typeof vi.fn>;
  setExport: ReturnType<typeof vi.fn>;
  days: () => number;
  isActive: () => boolean;
  navigate: ReturnType<typeof vi.fn>;
}

function registry(): Registry {
  return (window as unknown as { VinaXAdminSections: Registry }).VinaXAdminSections;
}

function loadScripts(): void {
  for (const f of ['sections/registry.js', 'sections/recquality.js', 'sections/aiops.js', 'sections/recconfig.js']) new Function(read(f))();
}

function helpers(answer: (path: string) => unknown, post: (path: string, body: unknown) => unknown = () => ({ ok: true })): Helpers {
  const api = vi.fn((path: string) => Promise.resolve(answer(path)));
  return {
    api,
    apiMemo: vi.fn((path: string) => api(path)),
    postApi: vi.fn((path: string, body: unknown) => Promise.resolve(post(path, body))),
    esc,
    html,
    $: (id) => document.getElementById(id),
    view: (markup) => { document.getElementById('view')!.innerHTML = markup; },
    fail: vi.fn(),
    stamp: vi.fn(),
    setExport: vi.fn(),
    days: () => 7,
    isActive: () => true,
    navigate: vi.fn(),
  };
}

const view = (): HTMLElement => document.getElementById('view')!;
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const click = (id: string): void => { (document.getElementById(id) as HTMLElement).click(); };

/** Nothing in the panel was built from data: no injected elements, handlers or script links. */
function expectInert(): void {
  const root = view();
  expect(root.querySelector('img, script, iframe, object, embed, svg')).toBeNull();
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) {
      expect(a.name.startsWith('on'), `${el.tagName} has ${a.name}`).toBe(false);
      if (a.name === 'href' || a.name === 'src') expect(a.value.trim().toLowerCase().startsWith('javascript:')).toBe(false);
    }
  }
}

// ---- fixtures: the server's answers, with markup in every label ----------------

const rate = (k: number, n: number, low: number, high: number) => ({ k, n, rate: Math.round((k / n) * 1e4) / 1e4, low, high });
const dist = { n: 5, p50: 45, p50Low: 5, p50High: 210, p95: null };

const recQuality = () => ({
  configured: true, provisioned: true, scope: 'opt-in', days: 7, sampled: 9, truncated: false, minDevices: 3, devices: 4,
  overall: {
    key: 'all', devices: 4, continuations: 4, exposures: 5, withheld: false,
    served: { songs: 20, latencyMs: { n: 4, p50: 400, p50Low: 300, p50High: 9000, p95: null }, fallback: { ...rate(2, 4, 0.15, 0.85), byReason: { [HOSTILE]: 1 } },
      languageViolations: { songs: 2, rate: rate(2, 20, 0.03, 0.3) }, discovery: rate(4, 20, 0.08, 0.42), diversity: { n: 0, mean: null }, relaxed: { [HOSTILE]: 2 } },
    outcomes: { heardSec: dist, completion: rate(1, 5, 0.04, 0.62), skip: rate(3, 5, 0.23, 0.88), earlySkip: rate(2, 5, 0.12, 0.77), likes: rate(1, 5, 0.04, 0.62), repeats: rate(1, 5, 0.04, 0.62) },
  },
  byAlg: [
    { key: HOSTILE, devices: 1, continuations: 1, exposures: 0, withheld: true, served: null, outcomes: null },
    { key: '1.2.0', devices: 3, continuations: 3, exposures: 5, withheld: false, served: null, outcomes: { heardSec: dist, completion: rate(1, 5, 0.04, 0.62), skip: rate(3, 5, 0.23, 0.88), earlySkip: rate(2, 5, 0.12, 0.77), likes: rate(1, 5, 0.04, 0.62), repeats: rate(1, 5, 0.04, 0.62) } },
  ],
  byPicker: [],
  byVariant: [{ key: `rec-weights: ${HOSTILE}`, devices: 2, continuations: 2, exposures: 1, withheld: true, served: null, outcomes: null }],
});

const opsGroup = (key: string) => ({
  key, calls: 3, failures: 1, failureRate: rate(1, 3, 0.06, 0.79), latencyMs: { n: 3, p50: 3000, p95: 11000 }, hops: 1, blocked: { disabled: 1, overBudget: 0 },
  tokens: { prompt: 2000, completion: 1000, reportedCalls: 2 }, cost: { usd: 0.004, pricedCalls: 2, unpricedCalls: 0, unreportedCalls: 1, complete: false },
});
const PUBLISHED_AT = '2026-09-19T09:00:00.000Z';
const aiOps = (over: Record<string, unknown> = {}) => ({
  configured: true, days: 7, sampled: 3, truncated: false, tokenColumns: true,
  totals: opsGroup('all'), byFeature: [opsGroup(HOSTILE)], byLane: [opsGroup(HOSTILE)],
  today: { day: '2026-09-19', calls: 3, tokens: 3000, cost: { usd: 0.004, pricedCalls: 2, unpricedCalls: 0, unreportedCalls: 1, complete: false } },
  controls: { read: 'ok', published: true, value: { emergencyOff: false, features: { dj: true, tts: false }, dailyTokenCap: 100000, dailyCostCapUsd: null, updatedAt: PUBLISHED_AT, updatedBy: HOSTILE }, rowUpdatedAt: PUBLISHED_AT },
  budget: { day: '2026-09-19', tokenCap: 100000, tokensToday: 3000, tokenPct: 3, costCapUsd: null, costTodayUsd: 0.004, costComplete: false, costPct: null, state: 'within' },
  prices: { read: 'ok', configured: true },
  ...over,
});

const recConfig = (over: Record<string, unknown> = {}) => {
  const current = { version: 2, overrides: { mood: 0.2 }, rollout: { mode: 'experiment', experimentKey: 'rec-weights', variant: HOSTILE }, note: HOSTILE, evaluation: null, updatedAt: PUBLISHED_AT, updatedBy: HOSTILE };
  return {
    configured: true, version: 2, live: true, current,
    history: [current, { version: 1, overrides: {}, rollout: { mode: 'off' }, note: 'first', evaluation: { summary: HOSTILE, url: 'javascript:alert(1)', at: '' }, updatedAt: PUBLISHED_AT, updatedBy: 'ops' }],
    weights: [
      { key: 'mood', default: 0.16, min: 0.08, max: 0.32, touches: [`reason: mood ${HOSTILE}`] },
      { key: 'session', default: 0.12, min: 0.06, max: 0.24, touches: [], note: 'Declared but not read by the scorer: an override changes nothing.' },
    ],
    range: { minFactor: 0.5, maxFactor: 2 }, baseVersion: '1.2.0', evalCommand: 'node frontend/scripts/eval-recs.mjs',
    experiments: [{ key: 'rec-weights', name: HOSTILE, active: true, variants: [{ name: 'control', pct: 50 }, { name: HOSTILE, pct: 50 }] }],
    experimentsRead: 'ok',
    ...over,
  };
};

beforeEach(() => {
  document.body.innerHTML = '<span id="secCrumb"></span><h2 id="secTitle"></h2><div id="view"></div>';
  loadScripts();
});
afterEach(() => { document.body.innerHTML = ''; });

describe('section registry', () => {
  it('registers the three 7.2 panels; Recommendation Tuning is an editor the auto-refresh leaves alone', () => {
    expect(registry().keys().sort()).toEqual(['aiops', 'recconfig', 'recquality']);
    expect(registry().get('recconfig')!.local).toBe(true);
    expect(registry().get('recquality')!.local).toBe(false);
  });

  it('fills the toolbar heading only while app.js left it empty', async () => {
    await registry().get('aiops')!.load(helpers(() => aiOps()));
    expect(document.getElementById('secTitle')!.textContent).toBe('AI Operations');
    expect(document.getElementById('secCrumb')!.textContent).toBe('AI & Engines');
    document.getElementById('secTitle')!.textContent = 'Named by app.js';
    await registry().get('recquality')!.load(helpers(() => recQuality()));
    expect(document.getElementById('secTitle')!.textContent).toBe('Named by app.js');
  });

  it('esc and html come from app.js and escape markup', () => {
    expect(esc(HOSTILE)).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(html`<b>${HOSTILE}</b>`).toBe('<b>&lt;img src=x onerror=alert(1)&gt;</b>');
  });

  it.each(['recquality', 'aiops', 'recconfig'])('%s renders an unexpected answer as a message, without throwing', async (key) => {
    const h = helpers(() => ({ ok: true, items: [] }));
    await registry().get(key)!.load(h);
    await flush();
    expect(view().textContent!.trim().length).toBeGreaterThan(0);
    expect(h.fail).not.toHaveBeenCalled();
  });

  it.each(['recquality', 'aiops', 'recconfig'])('%s hands a failed read to h.fail, never zeros', async (key) => {
    const h = helpers(() => ({}));
    h.api.mockImplementation(() => Promise.reject(new Error('http 502')));
    await registry().get(key)!.load(h);
    await flush();
    expect(h.fail).toHaveBeenCalled();
  });
});

describe('console markup (index.html)', () => {
  const indexHtml = read('index.html');
  const count = (group: string): number => Number(new RegExp(`data-group="${group}"[^\\n]*?<span class="ng-n">(\\d+)</span>`).exec(indexHtml)?.[1]);
  const entries = (cat: string): number => (indexHtml.match(new RegExp(`data-sec="[a-z0-9-]+" data-cat="${cat}"`, 'g')) ?? []).length;

  it('each 7.2 section has a nav entry and loads after app.js', () => {
    const app = indexHtml.indexOf('<script src="/admin/app.js"></script>');
    expect(app).toBeGreaterThan(0);
    for (const key of ['recquality', 'aiops', 'recconfig']) {
      expect(indexHtml).toContain(`data-sec="${key}"`);
      expect(indexHtml.indexOf(`<script src="/admin/sections/${key}.js"></script>`)).toBeGreaterThan(app);
    }
    expect(count('Analytics')).toBe(entries('Analytics'));
    expect(count('AI &amp; Engines')).toBe(entries('AI &amp; Engines'));
  });

  it('browser-local sections are marked on the nav entry and at the top of the panel', () => {
    for (const key of ['workspace', 'config', 'pins']) expect(indexHtml).toMatch(new RegExp(`data-sec="${key}"[^>]*data-local="(all|prefs)"`));
    expect(indexHtml).toContain("#nav button[data-sec][data-local]::after { content: 'this browser only'");
    expect(indexHtml).toContain('#app:has(#nav button[data-local].active) #view::before');
    // The server-backed 7.2 panels are not marked.
    for (const key of ['recquality', 'aiops', 'recconfig']) expect(indexHtml).not.toMatch(new RegExp(`data-sec="${key}"[^>]*data-local`));
  });
});

describe('Recommendation Quality', () => {
  it('renders hostile labels as text', async () => {
    const h = helpers(() => recQuality());
    await registry().get('recquality')!.load(h);
    await flush();
    expectInert();
    expect(view().textContent).toContain(HOSTILE);
  });

  it('leads with the opt-in scope and shows small samples as counts with wide intervals', async () => {
    const h = helpers(() => recQuality());
    await registry().get('recquality')!.load(h);
    await flush();
    const text = view().textContent!;
    expect(text).toContain('Opt-in telemetry only — 4 devices.');
    expect(text).toContain('not all listeners');
    expect(text).toContain('1 of 5 (likely 4–62%)');
    expect(text).not.toMatch(/Completion rate20%/);
    expect(text).toContain('Counts only — fewer than 3 devices');
    expect(h.api.mock.calls[0][0]).toBe('/api/admin/recquality?days=7');
  });

  it('says "not provisioned" when the events table has no meta column', async () => {
    const h = helpers(() => ({ configured: true, provisioned: false, days: 7, error: 'meta_not_provisioned', note: HOSTILE }));
    await registry().get('recquality')!.load(h);
    await flush();
    expectInert();
    expect(view().textContent).toContain('Not provisioned.');
  });
});

describe('AI Operations', () => {
  it('renders hostile labels as text and never shows an unknown cost as $0', async () => {
    const h = helpers(() => aiOps({ byLane: [{ ...opsGroup(HOSTILE), cost: { usd: null, pricedCalls: 0, unpricedCalls: 3, unreportedCalls: 0, complete: false } }] }));
    await registry().get('aiops')!.load(h);
    await flush();
    expectInert();
    const text = view().textContent!;
    expect(text).toContain(HOSTILE);
    expect(text).toContain('unknown');
    expect(text).not.toContain('$0.0000');
  });

  it('asks for confirmation before switching all AI off, then publishes ai-controls', async () => {
    const h = helpers(
      (path) => (path.startsWith('/api/admin/appconfig') ? { configured: true, value: { updatedAt: PUBLISHED_AT } } : aiOps()),
      () => ({ ok: true }),
    );
    await registry().get('aiops')!.load(h);
    await flush();
    const off = document.getElementById('ao-off') as HTMLInputElement;
    off.checked = true;
    off.dispatchEvent(new Event('change'));
    click('ao-publish');
    await flush();
    expect(document.getElementById('ao-confirm')).not.toBeNull();
    expect(h.postApi).not.toHaveBeenCalled();

    click('ao-confirm-yes');
    await flush();
    expect(h.postApi).toHaveBeenCalledTimes(1);
    const [path, body] = h.postApi.mock.calls[0] as [string, { key: string; value: { emergencyOff: boolean; features: Record<string, boolean>; dailyTokenCap: number | null } }];
    expect(path).toBe('/api/admin/appconfig');
    expect(body.key).toBe('ai-controls');
    expect(body.value.emergencyOff).toBe(true);
    expect(body.value.features.tts).toBe(false);
    expect(Object.keys(body.value.features)).toHaveLength(11);
    expect(body.value.dailyTokenCap).toBe(100000);
  });

  it('cancelling the confirmation publishes nothing', async () => {
    const h = helpers(() => aiOps());
    await registry().get('aiops')!.load(h);
    await flush();
    const off = document.getElementById('ao-off') as HTMLInputElement;
    off.checked = true;
    off.dispatchEvent(new Event('change'));
    click('ao-publish');
    await flush();
    click('ao-confirm-no');
    await flush();
    expect(document.getElementById('ao-confirm')).toBeNull();
    expect(h.postApi).not.toHaveBeenCalled();
  });

  it('refuses to overwrite controls someone else published after the panel loaded', async () => {
    const h = helpers((path) => (path.startsWith('/api/admin/appconfig') ? { configured: true, value: { updatedAt: '2026-09-19T11:11:11.000Z', updatedBy: HOSTILE } } : aiOps()));
    await registry().get('aiops')!.load(h);
    await flush();
    const tts = document.querySelector('[data-ao-feature="tts"]') as HTMLInputElement;
    tts.checked = true;
    tts.dispatchEvent(new Event('change'));
    click('ao-publish');
    await flush();
    expect(h.postApi).not.toHaveBeenCalled();
    expect(document.getElementById('ao-out')!.textContent).toMatch(/after you started editing/);
    expectInert();
  });

  it('says so when this Worker does not accept ai-controls yet', async () => {
    const h = helpers((path) => (path.startsWith('/api/admin/appconfig') ? { configured: true, value: { updatedAt: PUBLISHED_AT } } : aiOps()), () => ({ error: 'unknown_key' }));
    await registry().get('aiops')!.load(h);
    await flush();
    const dj = document.querySelector('[data-ao-feature="dj"]') as HTMLInputElement;
    dj.checked = false;
    dj.dispatchEvent(new Event('change'));
    click('ao-publish');
    await flush();
    expect(h.postApi).toHaveBeenCalledTimes(1);
    expect(document.getElementById('ao-out')!.textContent).toMatch(/does not accept ai-controls yet/);
  });
});

describe('Recommendation Tuning', () => {
  it('renders hostile labels as text, links only https reports, and labels unvalidated versions', async () => {
    const h = helpers(() => recConfig());
    await registry().get('recconfig')!.load(h);
    await flush();
    expectInert();
    const text = view().textContent!;
    expect(text).toContain(HOSTILE);
    const header = document.getElementById('rc-published')!.textContent!;
    expect(header).toContain('Published — v2');
    expect(header).toContain('unvalidated — no evaluation attached');
    expect(header).toContain('not a proven improvement');
    expect(view().querySelector('a')).toBeNull();
  });

  it('an evaluated version says evidence, not proof', async () => {
    const h = helpers(() => recConfig({ current: { ...recConfig().current, evaluation: { summary: 'replay of 500 sessions', url: 'https://example.test/r/1', at: PUBLISHED_AT } } }));
    await registry().get('recconfig')!.load(h);
    await flush();
    expectInert();
    const header = document.getElementById('rc-published')!.textContent!;
    expect(header).toContain('evaluation attached');
    expect(header).not.toContain('unvalidated');
    expect(header).toContain('evidence, not proof');
    expect(view().querySelector('a')!.getAttribute('href')).toBe('https://example.test/r/1');
  });

  it('previews before / after with the terms each weight moves and the offline evaluation command', async () => {
    const h = helpers(() => recConfig());
    await registry().get('recconfig')!.load(h);
    await flush();
    const input = document.querySelector('[data-rc-weight="mood"]') as HTMLInputElement;
    input.value = '0.5';
    input.dispatchEvent(new Event('input'));
    click('rc-preview');
    await flush();
    const card = document.getElementById('rc-preview-card')!;
    expect(card.textContent).toContain('0.32 (clamped from 0.5)');
    expect(card.textContent).toContain('+60%');
    expect(card.textContent).toContain(`reason: mood ${HOSTILE}`);
    expect(card.textContent).toContain('node frontend/scripts/eval-recs.mjs');
    expect(card.textContent).toContain('unvalidated — no evaluation attached');
    expectInert();
  });

  it('publishes from the version it was edited from and shows a 409 instead of retrying', async () => {
    const theirs = { version: 3, overrides: { mood: 0.3 }, rollout: { mode: 'all' }, note: '', evaluation: null, updatedAt: PUBLISHED_AT, updatedBy: HOSTILE };
    const h = helpers(() => recConfig(), () => ({ error: 'version_conflict', version: 3, current: theirs }));
    await registry().get('recconfig')!.load(h);
    await flush();
    const input = document.querySelector('[data-rc-weight="mood"]') as HTMLInputElement;
    input.value = '0.25';
    input.dispatchEvent(new Event('input'));
    click('rc-publish');
    await flush();
    expect(h.postApi).toHaveBeenCalledTimes(1);
    const body = h.postApi.mock.calls[0][1] as { expectedVersion: number; overrides: Record<string, number>; rollout: { mode: string } };
    expect(body.expectedVersion).toBe(2);
    expect(body.overrides).toEqual({ mood: 0.25 });
    expect(body.rollout.mode).toBe('experiment');
    const conflict = document.getElementById('rc-conflict')!;
    expect(conflict.textContent).toContain('v3 was published');
    expect(conflict.textContent).toContain(HOSTILE);
    expect(h.api).toHaveBeenCalledTimes(1); // no silent reload over the operator's edits
    expectInert();
  });

  it('rolls back only after an inline confirmation', async () => {
    const h = helpers(() => recConfig(), () => ({ ok: true, record: { version: 3, overrides: {}, rollout: { mode: 'off' }, evaluation: null }, clamped: [], historySaved: true }));
    await registry().get('recconfig')!.load(h);
    await flush();
    (document.querySelector('[data-rc-rollback="1"]') as HTMLElement).click();
    await flush();
    expect(h.postApi).not.toHaveBeenCalled();
    (document.querySelector('[data-rc-rollback-yes="1"]') as HTMLElement).click();
    await flush();
    expect(h.postApi).toHaveBeenCalledWith('/api/admin/recconfig', expect.objectContaining({ action: 'rollback', toVersion: 1, expectedVersion: 2 }));
  });
});
