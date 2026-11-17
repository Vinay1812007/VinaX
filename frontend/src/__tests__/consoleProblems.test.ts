// @vitest-environment jsdom
/**
 * Schema 24 — the console's Songs With Problems page and the A/B Tests
 * Results panel, rendered from the e2e mock answers
 * (e2e/support/console-mocks/music.mjs and engage.mjs): one-click Block and
 * Find Music per song, a database that still needs its update, results per
 * version with the minimum-sample warning, and the plain word that other
 * tests have no exposure data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REC_EXPERIMENT_KEYS } from '@/features/experiments/recExperiment';

const ADMIN = join(__dirname, '..', '..', 'public', 'admin');
const read = (rel: string): string => readFileSync(join(ADMIN, rel), 'utf8');

interface ApiRes { ok: boolean; status: number; data: unknown; error: string | null; message: string }
interface PageDef { id: string; title: string; group: string; icon: string; order: number; range?: boolean; render: (host: HTMLElement, ctx: unknown) => unknown }
interface VXType {
  me: { role: string } | null;
  pages: () => PageDef[];
  api: { get: (path: string, params?: Record<string, unknown>) => Promise<ApiRes>; post: (path: string, body?: unknown) => Promise<ApiRes> };
}
type Mocks = Record<string, (url: URL, body: unknown) => unknown>;

let VX: VXType;
let mocks: Mocks;
let gets: Array<{ path: string; params: Record<string, unknown> }> = [];
let posts: Array<{ path: string; body: unknown }> = [];
let failWith: string | null = null;
let override: ((path: string, params: Record<string, unknown>) => unknown) | null = null;
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };

beforeAll(async () => {
  document.body.innerHTML = '<div id="toasts"></div>';
  const run = (src: string, name: string) => { new Function('window', 'document', `${src}\n//# sourceURL=${name}`)(window, document); };
  for (const f of ['core.js', 'kit/controls.js', 'kit/settings.js', 'pages/song-stats.js', 'pages/library.js', 'pages/song-problems.js', 'pages/ab-tests.js']) run(read(f), f);
  VX = (window as unknown as { VX: VXType }).VX;
  const load = async (name: string) => ((await import(/* @vite-ignore */ pathToFileURL(join(__dirname, '..', '..', 'e2e', 'support', 'console-mocks', name)).href)) as { default: Mocks }).default;
  mocks = { ...(await load('music.mjs')), ...(await load('engage.mjs')) };
  const answer = (method: string, path: string, params: Record<string, unknown> = {}, body: unknown = null): ApiRes => {
    if (failWith) return { ok: false, status: 502, data: { error: failWith }, error: failWith, message: 'failed' };
    const url = new URL(`http://console.test${path}`);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    const data = (method === 'GET' && override?.(path, params)) || mocks[`${method} ${path}`]?.(url, body) || { configured: true };
    return { ok: true, status: 200, data, error: null, message: '' };
  };
  VX.api.get = (path, params) => { gets.push({ path, params: params ?? {} }); return Promise.resolve(answer('GET', path, params)); };
  VX.api.post = (path, body) => { posts.push({ path, body }); return Promise.resolve(answer('POST', path, {}, body)); };
});

beforeEach(() => {
  gets = [];
  posts = [];
  failWith = null;
  override = null;
  VX.me = { role: 'owner' };
  document.querySelectorAll('.scrim, .modal, #drawer').forEach((n) => n.remove());
});

function ctx(gone: unknown[] = [], refreshed: number[] = []) {
  return {
    tab: null, page: 'test', params: {}, range: { key: '7', days: 7, from: null, to: null, label: 'Last 7 days' },
    setParam: () => {}, refresh: () => { refreshed.push(1); }, every: () => {}, onDispose: () => {}, onLeave: () => {}, stamp: () => {},
    go: (...a: unknown[]) => { gone.push(a); },
  };
}
const page = (id: string) => VX.pages().find((p) => p.id === id)!;
async function show(id: string, c = ctx()): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await page(id).render(host, c);
  await flush();
  return host;
}
const JUNK = /\bundefined\b|\bNaN\b|\[object Object\]/;
const buttons = (root: ParentNode, text: string) => [...root.querySelectorAll('button')].filter((b) => b.textContent?.trim() === text) as HTMLButtonElement[];

describe('Songs With Problems', () => {
  it('is a Music page after Songs People Skip, following the date range', () => {
    expect(page('song-problems')).toMatchObject({ title: 'Songs With Problems', group: 'Music', range: true });
    expect(read('index.html')).toContain('<script src="/admin/pages/song-problems.js"></script>');
  });

  it('lists songs that fail to play and songs with no lyrics, from the problems view, for the chosen days', async () => {
    const host = await show('song-problems');
    expect(gets[0]).toEqual({ path: '/api/admin/analytics', params: { view: 'problems', days: 7 } });
    const text = host.textContent ?? '';
    expect(text).not.toMatch(JUNK);
    expect(text).toContain('Songs that fail to play');
    expect(text).toContain('Songs with no lyrics');
    expect(text).toContain('Butta Bomma');
    expect(text).toContain('Arabic Kuthu');
    host.querySelectorAll('.stat-wrap').forEach((s) => expect(s.querySelector('.info-btn')).not.toBeNull());
    // s9 is blocked already: a "Blocked" mark instead of the button.
    expect(text).toContain('Blocked');
    expect(buttons(host, 'Block').length).toBe(4);
    expect(buttons(host, 'Find Music').length).toBe(5);
  });

  it('blocks a song in one click (after the reason), then refreshes; Find Music searches for it', async () => {
    const gone: unknown[] = [];
    const refreshed: number[] = [];
    const host = await show('song-problems', ctx(gone, refreshed));
    buttons(host, 'Find Music')[0].click();
    expect(gone[0]).toEqual(['find-music', null, { q: 'Butta Bomma Armaan Malik' }]);
    buttons(host, 'Block')[0].click();
    const modal = document.querySelector('.modal') as HTMLElement;
    expect(modal.textContent).toContain('Butta Bomma — Armaan Malik');
    buttons(modal, 'Block')[0].click();
    await flush();
    expect(posts).toEqual([{ path: '/api/admin/content', body: { action: 'block', kind: 'song', value: 's4', label: 'Butta Bomma — Armaan Malik', reason: 'Copyright' } }]);
    expect(refreshed.length).toBe(1);
  });

  it('a viewer cannot block', async () => {
    VX.me = { role: 'viewer' };
    const host = await show('song-problems');
    expect(buttons(host, 'Block').every((b) => b.disabled)).toBe(true);
    expect(host.textContent).toContain('view-only access');
  });

  it('asks for the database update instead of failing on an older schema', async () => {
    failWith = 'db_update_needed';
    const host = await show('song-problems');
    expect(host.textContent).toContain('One-time database update needed');
    expect(host.querySelector('.state.error')).toBeNull();
  });
});

describe('A/B Tests results', () => {
  it('measures only the tests the app logs exposure for', () => {
    // The console's list must match the keys the app can expose (recExperiment.ts).
    const listed = /var RESULT_KEYS = \[([^\]]*)\]/.exec(read('pages/ab-tests.js'))?.[1] ?? '';
    expect(listed.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)).toEqual([...REC_EXPERIMENT_KEYS]);
  });

  it('shows each version of the next-song test side by side, and says other tests have no data', async () => {
    const host = await show('ab-tests');
    expect(gets.some((g) => g.path === '/api/admin/experiments' && g.params.view === 'results' && g.params.key === 'rec-next-songs' && g.params.days === 30)).toBe(true);
    expect(gets.some((g) => g.params.view === 'results' && g.params.key === 'home-shelf-order')).toBe(false);
    const text = host.textContent ?? '';
    expect(text).not.toMatch(JUNK);
    expect(text).toContain('Results');
    expect(text).toContain('Version C: A little more like their taste');
    expect(text).toContain('Played to the end');
    expect(text).toContain('61.6%');
    expect(text).toContain('Came back in 7 days');
    expect(text).toContain('had the most songs played to the end (61.6%)');
    expect(text).toContain('Other tests, like the order of the Home screen, send nothing about who saw which version');
    expect(text).toContain('No results for: Discovery first on Home.');
  });

  it('warns when a version has too few people to pick a winner', async () => {
    override = (_path, params) => (params.view === 'results' ? { configured: true, view: 'results', data: { enough: false, minPeople: 30, minOutcomes: 100, variants: [
      { variant: 'control', people: 4, outcomes: 20, completeRate: 50, skipRate: 20, earlySkipRate: 10, playsPerPerson: 5, returnOf: 0, returned: 0, returnRate: null, enough: false },
    ] } } : null);
    const host = await show('ab-tests');
    const text = host.textContent ?? '';
    expect(text).not.toMatch(JUNK);
    expect(text).toContain('Too few people yet to pick a winner. Each version needs at least 30 people and 100 songs played.');
    expect(text).toContain('Not yet');
  });

  it('says plainly when nothing has been measured yet', async () => {
    override = (_path, params) => (params.view === 'results' ? { configured: true, view: 'results', data: {} } : null);
    const host = await show('ab-tests');
    expect(host.textContent).toContain('No results yet');
    expect(host.textContent).not.toMatch(JUNK);
  });
});
