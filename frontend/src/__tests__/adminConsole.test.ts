// @vitest-environment jsdom
/**
 * 13.8 — the rebuilt owner console (public/admin: core.js + pages/*.js + app.js).
 *
 * Loads the real core and every real page file into a DOM and pins:
 *  - index.html loads every page file (and only existing ones), core first,
 *    the shell last — scripts/admin-stamp.mjs can only stamp what it lists;
 *  - every page registers a unique id, a known sidebar group, a sprite icon,
 *    and either render() or tabs with unique ids and render functions;
 *  - no console script builds markup from strings (innerHTML and friends),
 *    so listener names, song titles and feedback text are always text;
 *  - every page and tab survives EMPTY ANSWERS (every endpoint answering an
 *    empty object) and a SERVER FAILURE (every endpoint failing) without
 *    throwing and without printing undefined / NaN / [object Object].
 *  - 14.0 — the database is back: twelve pages, the console lands on
 *    Overview, and every page talks to the server only through /api/admin.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ADMIN = join(__dirname, '..', '..', 'public', 'admin');
const read = (rel: string): string => readFileSync(join(ADMIN, rel), 'utf8');
const indexHtml = read('index.html');
const pageFiles = readdirSync(join(ADMIN, 'pages')).filter((f) => f.endsWith('.js')).sort();
const HOSTILE = '<img src=x onerror="window.__pwned=1">';
const GROUPS = ['System', 'Audience', 'Intelligence', 'Content'];

interface Tab { id: string; label: string; render: (host: HTMLElement, ctx: unknown) => unknown }
interface PageDef { id: string; title: string; group: string; icon?: string; render?: Tab['render']; tabs?: Tab[] }
interface ApiRes { ok: boolean; status: number; data: unknown; error: string | null; message: string }
interface VXType {
  h: (sel: string, ...rest: unknown[]) => HTMLElement;
  pages: () => PageDef[];
  api: { get: (...a: unknown[]) => Promise<ApiRes>; post: (...a: unknown[]) => Promise<ApiRes>; blob: (...a: unknown[]) => Promise<unknown>; clearMemo: () => void };
  fmt: Record<string, (...a: unknown[]) => string>;
}

let VX: VXType;
const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0));
};

beforeAll(() => {
  document.body.innerHTML = '<div id="toasts"></div>';
  // jsdom has no layout/scroll APIs some panels touch.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  const w = window as unknown as Record<string, unknown>;
  const run = (src: string, name: string) => {
    new Function('window', 'document', `${src}\n//# sourceURL=${name}`)(window, document);
  };
  run(read('core.js'), 'core.js');
  for (const f of pageFiles) run(read(`pages/${f}`), f);
  VX = w.VX as VXType;
});

describe('index.html', () => {
  const scripts = [...indexHtml.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);

  it('loads every page file, core before the pages, the shell last', () => {
    const pages = scripts.filter((s) => s.startsWith('/admin/pages/')).map((s) => s.slice('/admin/pages/'.length)).sort();
    expect(pages).toEqual(pageFiles);
    const core = scripts.indexOf('/admin/core.js');
    const app = scripts.indexOf('/admin/app.js');
    expect(core).toBeGreaterThanOrEqual(0);
    expect(app).toBe(scripts.length - 1);
    for (const s of scripts.filter((x) => x.startsWith('/admin/pages/'))) {
      expect(scripts.indexOf(s)).toBeGreaterThan(core);
    }
  });

  it('keeps the strict CSP: no inline script, scripts only from self', () => {
    expect(indexHtml).toContain("script-src 'self'");
    expect(indexHtml).not.toMatch(/<script>(?!<\/script>)/);
    expect(indexHtml).not.toMatch(/\son[a-z]+="/);
  });
});

describe('page registry', () => {
  it('every page file registers a well-formed page', () => {
    const pages = VX.pages();
    expect(pages.length).toBe(pageFiles.length);
    const ids = pages.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['ai', 'analytics', 'catalog', 'database', 'experiments', 'feedback', 'health', 'listeners', 'live', 'notify', 'overview', 'publish']);
    for (const p of pages) {
      expect(p.title, p.id).toBeTruthy();
      expect(GROUPS, p.id).toContain(p.group);
      expect(indexHtml, `${p.id} icon`).toContain(`id="i-${p.icon}"`);
      if (p.tabs) {
        expect(p.tabs.length, p.id).toBeGreaterThan(0);
        const tabIds = p.tabs.map((t) => t.id);
        expect(new Set(tabIds).size, p.id).toBe(tabIds.length);
        for (const t of p.tabs) {
          expect(typeof t.render, `${p.id}/${t.id}`).toBe('function');
          expect(t.label, `${p.id}/${t.id}`).toBeTruthy();
        }
      } else {
        expect(typeof p.render, p.id).toBe('function');
      }
    }
  });

  it('the shell lands on Overview; Health keeps its status and secrets tabs', () => {
    expect(read('app.js')).toContain("segs[0] || 'overview'");
    expect(read('app.js')).toContain("setHash('overview'");
    const health = VX.pages().find((p) => p.id === 'health');
    expect(health?.tabs?.map((t) => t.id)).toEqual(['status', 'errors', 'edge', 'releases', 'env']);
  });

  it('the console talks to the database only through the Worker (/api/admin), never to Supabase', () => {
    for (const f of ['index.html', 'core.js', 'app.js', ...pageFiles.map((x) => `pages/${x}`)]) {
      expect(read(f), f).not.toMatch(/supabase\.co|supabase-js|service_role|SUPABASE_SERVICE_ROLE_KEY=/);
    }
    const apiPaths = new Set<string>();
    for (const f of pageFiles) for (const m of read(`pages/${f}`).matchAll(/VX\.api\.(?:get|post)\('([^']+)'/g)) apiPaths.add(m[1]);
    for (const p of apiPaths) expect(p, p).toMatch(/^\/api\/(admin\/|aimodels$)/);
  });
});

describe('no markup from strings', () => {
  const files = ['core.js', 'app.js', ...pageFiles.map((f) => `pages/${f}`)];
  it.each(files)('%s never assigns HTML strings', (f) => {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/\.innerHTML\s*[+]?=/);
    expect(src).not.toMatch(/\.outerHTML\s*=/);
    expect(src).not.toMatch(/insertAdjacentHTML|document\.write|\beval\(|new Function\(/);
  });

  it.each(pageFiles)('pages/%s goes through VX.api (owner token on our routes, never on third-party hosts)', (f) => {
    expect(read(`pages/${f}`)).not.toMatch(/(^|[^.\w])fetch\(|XMLHttpRequest|navigator\.sendBeacon/);
  });

  it('VX.h renders data as text', () => {
    const el = VX.h('div', HOSTILE, VX.h('span', { title: HOSTILE }, HOSTILE));
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img');
  });
});

function makeCtx(params: Record<string, string> = {}) {
  return {
    tab: null,
    params,
    setParam: (k: string, v: string) => { params[k] = v; },
    refresh: () => {},
    every: () => {},
    onDispose: () => {},
    go: () => {},
  };
}

async function renderAll(respond: (path: string) => ApiRes): Promise<Array<{ where: string; text: string; error?: unknown }>> {
  const api = VX.api;
  const orig = { get: api.get, post: api.post, blob: api.blob };
  api.get = (path: unknown) => Promise.resolve(respond(String(path)));
  api.post = (path: unknown) => Promise.resolve(respond(String(path)));
  api.blob = () => Promise.resolve({ ok: false, status: 0 });
  const out: Array<{ where: string; text: string; error?: unknown }> = [];
  try {
    for (const p of VX.pages()) {
      for (const t of p.tabs ?? [{ id: '', label: '', render: p.render as Tab['render'] }]) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const where = `${p.id}${t.id ? '/' + t.id : ''}`;
        try {
          await Promise.resolve(t.render(host, makeCtx()));
          await flush();
          out.push({ where, text: host.textContent ?? '' });
        } catch (error) {
          out.push({ where, text: host.textContent ?? '', error });
        }
        host.remove();
        document.querySelectorAll('#drawer, .scrim').forEach((n) => n.remove());
      }
    }
  } finally {
    Object.assign(api, orig);
  }
  return out;
}

const BAD_TEXT = /\bundefined\b|\bNaN\b|\[object Object\]/;

describe('empty and failing answers', () => {
  it('every page and tab renders from empty answers without errors or junk text', async () => {
    const results = await renderAll(() => ({ ok: true, status: 200, data: {}, error: null, message: '' }));
    const failures = results.filter((r) => r.error || BAD_TEXT.test(r.text)).map((r) => `${r.where}: ${r.error ? String(r.error) : r.text.match(BAD_TEXT)?.[0]}`);
    expect(failures).toEqual([]);
    const tabs = VX.pages().reduce((n, p) => n + (p.tabs ? p.tabs.length : 1), 0);
    expect(results.length).toBe(tabs);
    expect(tabs).toBe(32);
  });

  it('every page and tab shows an error state, not a crash, when the server fails', async () => {
    const results = await renderAll(() => ({ ok: false, status: 502, data: { error: 'upstream_unavailable' }, error: 'upstream_unavailable', message: 'The server could not answer right now.' }));
    const failures = results.filter((r) => r.error || BAD_TEXT.test(r.text)).map((r) => `${r.where}: ${r.error ? String(r.error) : 'junk text'}`);
    expect(failures).toEqual([]);
  });
});
