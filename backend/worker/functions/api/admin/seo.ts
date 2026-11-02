/**
 * V2 1.0.1 — GET /api/admin/seo[?path=/some/page] — the console's SEO tab.
 *
 * Reads the LIVE site the way a crawler does, from the server:
 *   - robots.txt: reachable, which sitemap it names, which crawlers it blocks;
 *   - the sitemap index and every map it lists: URL counts and last-modified;
 *   - a page audit of a fixed sample (home, key routes, three mood × language
 *     hubs, the first song / album / artist pages in entity-pages.xml) or of
 *     one path the owner asks about: status, title, description, canonical,
 *     H1, JSON-LD types, indexable text, social image, and what is wrong.
 *
 * Console rebuild — ?view=bots answers the crawler list (Allow / Block per bot,
 * the owner's choices from the `robots` setting, and whether the live file
 * matches); POST { action: 'publish_robots' } asks the website host to rebuild
 * so robots.txt picks the choices up (PAGES_DEPLOY_HOOK). See _lib/robots.ts.
 *
 * Since V2 1.0 these pages and maps are static files on the static host, so
 * crawlers reading them spend nothing from the Worker's daily quota; this
 * route spends about twenty sub-requests, only when the owner opens the tab,
 * and is rate-limited.
 */
import { adminJson, badRequest, isAdminAsync, requireRole, unauthorized, type AdminAuthEnv } from '../../_lib/admin';
import { audit } from '../../_lib/audit';
import { readJsonCapped } from '../../_lib/body';
import { dbConfigured, type DbEnv } from '../../_lib/db';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { BOT_GROUPS, BOTS, botChoices, readRobotsBlocked } from '../../_lib/robots';
import { setting } from '../../_lib/settings';

type Env = AdminAuthEnv & DbEnv & {
  /** Cloudflare Pages deploy hook URL: POSTing it rebuilds the website (robots.txt comes from the build). */
  PAGES_DEPLOY_HOOK?: string;
};

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Pages audited on every run, besides a sample of song / album / artist pages. */
export const AUDIT_PATHS = ['/', '/top-songs/', '/charts/', '/telugu-songs', '/hindi-songs', '/telugu-romantic-songs', '/hindi-romantic-songs', '/tamil-sad-songs', '/about/'];

export interface PageAudit {
  path: string;
  status: number;
  ms: number;
  title: string | null;
  description: string | null;
  canonical: string | null;
  h1: string | null;
  jsonLd: string[];
  words: number;
  ogImage: boolean;
  noindex: boolean;
  issues: string[];
}

export interface MapInfo { path: string; status: number; urls: number; lastmod: string | null; sample: string[] }

async function get(url: string, timeoutMs = 8000): Promise<{ status: number; ms: number; text: string; type: string }> {
  const t0 = Date.now();
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: c.signal, redirect: 'follow', headers: { 'user-agent': 'VinaX-Admin-SEO (like Googlebot)', 'cache-control': 'no-cache' } });
    const text = await r.text();
    return { status: r.status, ms: Date.now() - t0, text: text.slice(0, 1_500_000), type: r.headers.get('content-type') ?? '' };
  } catch {
    return { status: 0, ms: Date.now() - t0, text: '', type: '' };
  } finally {
    clearTimeout(timer);
  }
}

const decode = (s: string): string => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** What a crawler reads from one HTML page, and what is wrong with it. Pure. */
export function auditHtml(path: string, status: number, html: string, origin: string): Omit<PageAudit, 'ms'> {
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1];
  const description = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html)?.[1];
  const canonicals = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]*)"/gi)].map((m) => m[1]);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const jsonLd = new Set<string>();
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    for (const t of m[1].matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)) jsonLd.add(t[1]);
  }
  // The crawlable block every prerendered page carries (<main id="seo-content">, or the older <div> form).
  const at = html.search(/id="seo-content"/);
  const rest = at < 0 ? '' : html.slice(at);
  const stop = rest.search(/<\/main>/i);
  const seo = stop > 0 ? rest.slice(0, stop) : rest.slice(0, 30_000);
  const words = seo.replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => /\w/.test(w)).length;
  const noindex = /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html);
  const ogImage = /<meta\s+property="og:image"/i.test(html);
  const issues: string[] = [];
  const want = `${origin}${path === '/' ? '/' : path}`;
  const norm = (u: string): string => u.replace(/\/$/, '');
  if (status !== 200) issues.push(`answers ${status || 'nothing'}`);
  if (!title) issues.push('no title');
  else if (decode(title).length > 70) issues.push(`title is ${decode(title).length} characters (keep under 70)`);
  if (!description) issues.push('no meta description');
  else if (decode(description).length < 50 || decode(description).length > 160) issues.push(`description is ${decode(description).length} characters (50–160)`);
  if (!canonicals.length) issues.push('no canonical');
  else if (canonicals.length > 1) issues.push(`${canonicals.length} canonicals`);
  else if (norm(canonicals[0]) !== norm(want)) issues.push(`canonical points to ${canonicals[0].replace(origin, '') || '/'}`);
  if (!h1) issues.push('no H1');
  if (!jsonLd.size) issues.push('no structured data');
  if (words < 60) issues.push(`only ${words} words of crawlable text`);
  if (noindex) issues.push('marked noindex');
  return {
    path,
    status,
    title: title ? decode(title) : null,
    description: description ? decode(description) : null,
    canonical: canonicals[0] ?? null,
    h1: h1 ? decode(h1.replace(/<[^>]+>/g, ' ')) : null,
    jsonLd: [...jsonLd],
    words,
    ogImage,
    noindex,
    issues,
  };
}

/** URLs and the newest lastmod in a sitemap or sitemap index. Pure. */
export function readSitemap(xml: string): { locs: string[]; lastmod: string | null } {
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const mods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1].trim()).sort();
  return { locs, lastmod: mods[mods.length - 1] ?? null };
}

/** robots.txt facts. Pure. */
export function readRobots(text: string): { sitemaps: string[]; blockedAgents: string[]; disallowAll: boolean } {
  const sitemaps = [...text.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const blocked: string[] = [];
  let agents: string[] = [];
  let disallowAll = false;
  let inRules = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [k, ...rest] = line.split(':');
    const v = rest.join(':').trim();
    const key = k.trim().toLowerCase();
    if (key === 'user-agent') {
      if (inRules) agents = [];
      inRules = false;
      agents.push(v);
    } else if (key === 'disallow' || key === 'allow') {
      inRules = true;
      if (key === 'disallow' && v === '/') {
        for (const a of agents) if (a === '*') disallowAll = true; else blocked.push(a);
      }
    }
  }
  return { sitemaps, blockedAgents: [...new Set(blocked)], disallowAll };
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  const url = new URL(request.url);
  const origin = url.origin.replace('://admin.', '://www.');

  // The bots list: cheap (one read of the live robots.txt), not rate-limited with the audit.
  if (url.searchParams.get('view') === 'bots') {
    const [raw, live] = await Promise.all([dbConfigured(env) ? setting(env, 'robots') : Promise.resolve(null), get(`${origin}/robots.txt`, 5000)]);
    const choices = botChoices(raw);
    const liveBlocked = live.status === 200 ? new Set(readRobotsBlocked(live.text)) : null;
    return json({
      groups: BOT_GROUPS,
      bots: BOTS.map((b) => ({ id: b.id, name: b.name, about: b.about, group: b.group, allowByDefault: b.allowByDefault, allowed: choices[b.id], live: liveBlocked ? !liveBlocked.has(b.id) : null })),
      saved: !!raw,
      publishReady: !!env.PAGES_DEPLOY_HOOK,
      liveStatus: live.status,
    });
  }

  const limited = await rateLimitAsync(request, 'admin-seo', { capacity: 4, refillPerMinute: 4 }, env);
  if (limited) return limited;

  // One page on request.
  const one = url.searchParams.get('path');
  if (one !== null) {
    if (!/^\/[\w\-./%]{0,200}$/.test(one) || one.includes('..')) return json({ error: 'bad_path' }, 400);
    const r = await get(`${origin}${one}`);
    return json({ page: { ...auditHtml(one, r.status, r.text, origin), ms: r.ms } });
  }

  const [robotsRes, indexRes] = await Promise.all([get(`${origin}/robots.txt`), get(`${origin}/sitemap.xml`)]);
  const robots = { status: robotsRes.status, ...readRobots(robotsRes.text) };
  const index = readSitemap(indexRes.text);
  const childPaths = index.locs.map((l) => l.replace(origin, '')).filter((p) => p.startsWith('/')).slice(0, 8);
  const maps: MapInfo[] = await Promise.all(childPaths.map(async (path) => {
    const r = await get(`${origin}${path}`);
    const m = readSitemap(r.text);
    return { path, status: r.status, urls: m.locs.length, lastmod: m.lastmod, sample: m.locs.slice(0, 3).map((l) => l.replace(origin, '')) };
  }));

  // The audit sample: the fixed routes, then the first song, album and artist page.
  const entityMap = maps.find((m) => m.path.includes('entity'));
  let entitySample: string[] = [];
  if (entityMap && entityMap.urls) {
    const all = readSitemap((await get(`${origin}${entityMap.path}`)).text).locs.map((l) => l.replace(origin, ''));
    for (const kind of ['/song/', '/album/', '/artist/']) {
      const p = all.find((x) => x.startsWith(kind));
      if (p) entitySample.push(p);
    }
  }
  entitySample = entitySample.slice(0, 3);
  const pages: PageAudit[] = await Promise.all([...AUDIT_PATHS, ...entitySample].map(async (path) => {
    const r = await get(`${origin}${path}`);
    return { ...auditHtml(path, r.status, r.text, origin), ms: r.ms };
  }));

  const indexable = maps.reduce((n, m) => n + m.urls, 0);
  return json({
    origin,
    checkedAt: new Date().toISOString(),
    robots,
    sitemap: { status: indexRes.status, maps: index.locs.length, lastmod: index.lastmod },
    maps,
    indexable,
    pages,
    issues: pages.reduce((n, p) => n + p.issues.length, 0) + (robots.status !== 200 ? 1 : 0) + (indexRes.status !== 200 ? 1 : 0) + (robots.disallowAll ? 1 : 0),
  });
};

/** POST { action: 'publish_robots' } — rebuild the website so robots.txt follows the saved choices (editor). */
export const onRequestPost = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = context;
  const auth = await requireRole(request, env, 'editor');
  if (!auth.ok) return auth.response;
  const read = await readJsonCapped<{ action?: unknown } | null>(request, 2048);
  if (!read.ok || !read.value || read.value.action !== 'publish_robots') return badRequest('unknown_action');
  const hook = env.PAGES_DEPLOY_HOOK?.trim();
  if (!hook || !/^https:\/\//.test(hook)) return adminJson({ ok: false, error: 'publish_not_configured' }, 400);
  let ok: boolean;
  try {
    const r = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(10_000) });
    await r.body?.cancel().catch(() => undefined);
    ok = r.ok;
  } catch {
    ok = false;
  }
  if (!ok) return adminJson({ ok: false, error: 'publish_failed' }, 502);
  if (dbConfigured(env)) await audit({ env, request, waitUntil: context.waitUntil, actor: auth.me.email }, { action: 'robots-publish', summary: 'rebuilt the website so robots.txt uses the saved bot choices' });
  return adminJson({ ok: true });
};
