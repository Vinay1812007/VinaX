/**
 * v5.13.0 — Edge & Endpoint Health, the v5.11.4 outage as a dashboard.
 *
 * Loads the live app shell, finds every script/stylesheet it references and
 * verifies each one is really served as JavaScript/CSS (a poisoned edge
 * cache hands back the HTML shell under an asset URL — exactly the failure
 * that left the app stuck on "Updating…"). Then pings the public endpoints
 * the app cannot boot or play without, with status + latency. Admin-gated:
 * it fans out ~15 requests per call.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { rateLimit } from '../../_lib/ratelimit';

type Env = AdminEnv;

interface AssetCheck { path: string; kind: 'script' | 'style'; status: number; ms: number; contentType: string; ok: boolean; note: string | null; }
interface PingCheck { name: string; path: string; method: string; status: number; ms: number; ok: boolean; note: string | null; }

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const ENDPOINTS: Array<{ name: string; path: string; method?: string; expect?: number }> = [
  { name: 'Version', path: '/api/version' },
  { name: 'Site mode', path: '/api/site-mode' },
  { name: 'Status', path: '/api/status' },
  { name: 'App config · banners', path: '/api/appconfig?key=banners' },
  { name: 'Feature flags', path: '/api/appconfig?key=flags' },
  { name: 'Blocklist', path: '/api/blocklist' },
  { name: 'Trending searches', path: '/api/trending-searches' },
  { name: 'Announcements', path: '/api/announcements' },
  { name: 'Code preview (CORS preflight)', path: '/api/preview', method: 'OPTIONS', expect: 204 },
  { name: 'Catalog search', path: '/api/cat/search/songs?query=love&limit=1' },
  { name: 'Sitemap index', path: '/sitemap.xml' },
  { name: 'Web manifest', path: '/manifest.webmanifest' },
];

async function timed(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ res: Response | null; ms: number; error: string | null }> {
  const t0 = Date.now();
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, { ...init, signal: c.signal, headers: { 'user-agent': 'VinaX-Admin-Edge', 'cache-control': 'no-cache', ...(init.headers ?? {}) } });
    return { res, ms: Date.now() - t0, error: null };
  } catch (e) {
    return { res: null, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function extractAssets(html: string): Array<{ path: string; kind: 'script' | 'style' }> {
  const out = new Map<string, 'script' | 'style'>();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) out.set(m[1], 'script');
  for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) out.set(m[1], 'script');
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"[^>]*rel="modulepreload"/g)) out.set(m[1], 'script');
  for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) out.set(m[1], 'style');
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"[^>]*rel="stylesheet"/g)) out.set(m[1], 'style');
  return [...out.entries()].filter(([p]) => p.startsWith('/')).map(([path, kind]) => ({ path, kind })).slice(0, 12);
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const limited = rateLimit(request, 'admin-edge', { capacity: 6, refillPerMinute: 6 }, env as never);
  if (limited) return limited;
  const origin = new URL(request.url).origin.replace('admin.', 'www.');

  const shell = await timed(`${origin}/?vxedge=${Date.now()}`);
  const shellBody = shell.res ? await shell.res.text().catch(() => '') : '';
  const shellOk = !!shell.res && shell.res.ok && /<div id="root"|<div id="app"|<!doctype html/i.test(shellBody);
  const assets = extractAssets(shellBody);

  const assetChecks: AssetCheck[] = await Promise.all(
    assets.map(async (a) => {
      const r = await timed(`${origin}${a.path}`);
      if (!r.res) return { ...a, status: 0, ms: r.ms, contentType: '', ok: false, note: r.error };
      const ct = (r.res.headers.get('content-type') ?? '').toLowerCase();
      const head = (await r.res.text().catch(() => '')).slice(0, 200).trimStart().toLowerCase();
      const looksHtml = head.startsWith('<!doctype') || head.startsWith('<html');
      const typeOk = a.kind === 'script' ? /javascript|ecmascript/.test(ct) : ct.includes('text/css');
      const ok = r.res.ok && typeOk && !looksHtml;
      const note = !r.res.ok ? `http ${r.res.status}` : looksHtml ? 'HTML served under an asset URL — poisoned cache' : !typeOk ? `unexpected content-type ${ct || '(none)'}` : null;
      return { ...a, status: r.res.status, ms: r.ms, contentType: ct, ok, note };
    }),
  );

  const pings: PingCheck[] = await Promise.all(
    ENDPOINTS.map(async (e) => {
      const method = e.method ?? 'GET';
      const r = await timed(`${origin}${e.path}`, { method, headers: method === 'OPTIONS' ? { origin, 'access-control-request-method': 'POST' } : {} });
      if (!r.res) return { name: e.name, path: e.path, method, status: 0, ms: r.ms, ok: false, note: r.error };
      const ok = e.expect ? r.res.status === e.expect : r.res.ok;
      return { name: e.name, path: e.path, method, status: r.res.status, ms: r.ms, ok, note: ok ? null : `expected ${e.expect ?? '2xx'}` };
    }),
  );

  const cacheStatus = shell.res?.headers.get('cf-cache-status') ?? null;
  const build = /\/assets\/index-([A-Za-z0-9_-]+)\.js/.exec(shellBody)?.[1] ?? null;
  const problems = assetChecks.filter((a) => !a.ok).length + pings.filter((p) => !p.ok).length + (shellOk ? 0 : 1);
  return json({
    origin,
    checkedAt: new Date().toISOString(),
    shell: { status: shell.res?.status ?? 0, ms: shell.ms, ok: shellOk, bytes: shellBody.length, cacheStatus, build, error: shell.error },
    assets: assetChecks,
    endpoints: pings,
    problems,
    healthy: problems === 0,
  });
};
