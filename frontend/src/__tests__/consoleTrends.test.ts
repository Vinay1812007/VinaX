// @vitest-environment jsdom
/**
 * Schema 11 — the console's Trending and Search Insights pages, rendered from
 * the e2e mock answers (e2e/support/console-mocks/music.mjs): rank moves and
 * new entries, the "found nothing" fixes, pins posted with normalised words,
 * a database that still needs its update, and viewers seeing no edit actions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ADMIN = join(__dirname, '..', '..', 'public', 'admin');
const read = (rel: string): string => readFileSync(join(ADMIN, rel), 'utf8');

interface ApiRes { ok: boolean; status: number; data: unknown; error: string | null; message: string }
interface Tab { id: string; render: (host: HTMLElement, ctx: unknown) => unknown }
interface PageDef { id: string; title: string; group: string; icon: string; order: number; range?: boolean; render?: Tab['render']; tabs?: Tab[] }
interface VXType {
  me: { role: string } | null;
  pages: () => PageDef[];
  api: { get: (path: string, params?: Record<string, unknown>) => Promise<ApiRes>; post: (path: string, body?: unknown) => Promise<ApiRes> };
}
type Mocks = Record<string, (url: URL, body: unknown) => unknown>;

let VX: VXType;
let mocks: Mocks;
let posts: Array<{ path: string; body: unknown }> = [];
let failWith: string | null = null;
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };

beforeAll(async () => {
  document.body.innerHTML = '<div id="toasts"></div>';
  const run = (src: string, name: string) => { new Function('window', 'document', `${src}\n//# sourceURL=${name}`)(window, document); };
  for (const f of ['core.js', 'kit/controls.js', 'kit/settings.js', 'pages/song-stats.js', 'pages/library.js', 'pages/trending.js', 'pages/search-insights.js']) run(read(f), f);
  VX = (window as unknown as { VX: VXType }).VX;
  const file = pathToFileURL(join(__dirname, '..', '..', 'e2e', 'support', 'console-mocks', 'music.mjs')).href;
  mocks = ((await import(/* @vite-ignore */ file)) as { default: Mocks }).default;
  const answer = (method: string, path: string, params: Record<string, unknown> = {}, body: unknown = null): ApiRes => {
    if (failWith) return { ok: false, status: 502, data: { error: failWith }, error: failWith, message: 'failed' };
    const url = new URL(`http://console.test${path}`);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    const data = mocks[`${method} ${path}`]?.(url, body) ?? { configured: true };
    return { ok: true, status: 200, data, error: null, message: '' };
  };
  VX.api.get = (path, params) => Promise.resolve(answer('GET', path, params));
  VX.api.post = (path, body) => { posts.push({ path, body }); return Promise.resolve(answer('POST', path, {}, body)); };
});

beforeEach(() => {
  posts = [];
  failWith = null;
  VX.me = { role: 'owner' };
  document.querySelectorAll('.scrim, #drawer').forEach((n) => n.remove());
});

function ctx(gone: unknown[] = []) {
  return {
    tab: null, page: 'test', params: {}, range: { key: '7', days: 7, from: null, to: null, label: 'Last 7 days' },
    setParam: () => {}, refresh: () => {}, every: () => {}, onDispose: () => {}, onLeave: () => {}, stamp: () => {},
    go: (...a: unknown[]) => { gone.push(a); },
  };
}
const page = (id: string) => VX.pages().find((p) => p.id === id)!;
// Search Insights was one page with three tabs; each is its own page now.
const SEARCH: Record<string, string> = { overview: 'search-overview', 'nothing-found': 'search-no-results', pins: 'search-pins' };
async function show(id: string, tab?: string, c = ctx()): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const p = page(id);
  const render = tab ? p.tabs!.find((t) => t.id === tab)!.render : p.render!;
  await render(host, c);
  await flush();
  return host;
}
const JUNK = /\bundefined\b|\bNaN\b|\[object Object\]/;

describe('Trending', () => {
  it('is a Music Stats page between Languages and Songs People Skip, following the date range', () => {
    const p = page('trending');
    expect(p).toMatchObject({ title: 'Trending', group: 'Music Stats', icon: 'flame', range: true });
    expect(p.order).toBeGreaterThan(page('languages').order);
    expect(p.order).toBeLessThan(page('skipped-songs').order);
  });

  it('shows plays against the period before, rank moves, new entries and a sparkline per song', async () => {
    const gone: unknown[] = [];
    const host = await show('trending', undefined, ctx(gone));
    const text = host.textContent ?? '';
    expect(text).not.toMatch(JUNK);
    expect(text).toContain('Rising songs');
    expect(text).toContain('Top artists');
    expect(text).toContain('Languages');
    expect(host.querySelectorAll('.stat-wrap').length).toBe(4);
    host.querySelectorAll('.stat-wrap').forEach((s) => expect(s.querySelector('.info-btn')).not.toBeNull());
    expect([...host.querySelectorAll('.tr-move.up')].map((n) => n.textContent)).toContain('▲1');
    expect([...host.querySelectorAll('.tr-move.down')].map((n) => n.textContent)).toContain('▼1');
    expect(host.querySelector('.tr-move.new')?.textContent).toBe('NEW');
    expect(host.querySelector('.tr-spark .spark')).not.toBeNull();
    (host.querySelector('.tr-row') as HTMLButtonElement).click();
    expect(gone[0]).toEqual(['find-music', null, { q: expect.any(String) }]);
  });

  it('asks for the database update instead of failing on an older schema', async () => {
    failWith = 'db_update_needed';
    const host = await show('trending');
    expect(host.textContent).toContain('One-time database update needed');
    expect(host.querySelector('.state.error')).toBeNull();
    failWith = 'db_unavailable';
    expect((await show('trending')).querySelector('.state.error')).not.toBeNull();
  });
});

describe('Search Insights', () => {
  it('is three pages under Search & Library, and every stat card explains itself', async () => {
    expect(page('search-overview')).toMatchObject({ group: 'Search & Library', icon: 'search', range: true });
    expect(page('search-no-results')).toMatchObject({ group: 'Search & Library', range: true });
    expect(page('search-pins')).toMatchObject({ group: 'Search & Library', icon: 'pin' });
    for (const tab of ['overview', 'nothing-found', 'pins']) {
      const host = await show(SEARCH[tab]);
      expect(host.textContent, tab).not.toMatch(JUNK);
      expect(host.querySelectorAll('.stat-wrap').length, tab).toBeGreaterThan(0);
      host.querySelectorAll('.stat-wrap').forEach((s) => expect(s.querySelector('.info-btn'), tab).not.toBeNull());
    }
    const o = await show(SEARCH['overview']);
    expect(o.textContent).toContain('9%'); // 58 of 642 searches found nothing
    expect(o.querySelector('.chart-svg')).not.toBeNull();
  });

  it('pins a song for a search that found nothing, with the words as typed', async () => {
    const host = await show(SEARCH['nothing-found']);
    expect(host.textContent).toContain('kesariya remix');
    expect(host.textContent).toContain('Pinned: Naatu Naatu');
    const pinBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Pin a song…')!;
    pinBtn.click();
    const modal = document.querySelector('.modal') as HTMLElement;
    expect(modal.textContent).toContain('Pin a song');
    const save = () => [...modal.querySelectorAll('button')].find((b) => b.textContent === 'Pin this song')!;
    save().click();
    await flush();
    expect(modal.textContent).toContain('choose it from the list');
    expect(posts).toEqual([]);
    const input = modal.querySelector('.picker input') as HTMLInputElement;
    input.value = 'kesariya';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    await flush();
    const opt = modal.querySelector('.picker-opt') as HTMLElement;
    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    save().click();
    await flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ path: '/api/admin/trends', body: { action: 'pin', query: 'kesariya remix', song: { id: 'so1', title: expect.any(String) } } });
  });

  it('adds a synonym from the same list', async () => {
    const host = await show(SEARCH['nothing-found']);
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add a synonym…')!.click();
    const modal = document.querySelector('.modal') as HTMLElement;
    const [from, to] = [...modal.querySelectorAll('input')] as HTMLInputElement[];
    expect(from.value).toBe('kesariya remix');
    to.value = 'Kesariya';
    [...modal.querySelectorAll('button')].find((b) => b.textContent === 'Save synonym')!.click();
    await flush();
    expect(posts[0]?.body).toEqual({ action: 'synonym', typed: 'kesariya remix', meant: 'Kesariya' });
  });

  it('lists pins with remove and the synonyms read-only', async () => {
    const gone: unknown[] = [];
    const host = await show(SEARCH.pins, undefined, ctx(gone));
    expect(host.textContent).toContain('naatu song');
    expect(host.textContent).toContain('A. R. Rahman');
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Open App Settings')!.click();
    expect(gone[0]).toEqual(['app-settings/search']);
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!.click();
    await flush();
    [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Remove pin')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(posts[0]?.body).toEqual({ action: 'unpin', query: 'naatu song' });
  });

  it('viewers see the numbers but no way to change them', async () => {
    VX.me = { role: 'viewer' };
    for (const tab of ['nothing-found', 'pins']) {
      const host = await show(SEARCH[tab]);
      expect(host.textContent, tab).toContain('view-only access');
      const labels = [...host.querySelectorAll('button')].map((b) => b.textContent);
      for (const l of ['Pin a song…', 'Add a synonym…', 'Remove', 'Change…']) expect(labels, `${tab}: ${l}`).not.toContain(l);
    }
  });
});
