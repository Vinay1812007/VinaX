/**
 * Live health check for every music catalog source: the self-hosted
 * /api/cat catalog (checked in-process — the exact handler the app uses,
 * wrappers and direct translation included), then each configured wrapper
 * on its own (CATALOG_UPSTREAMS, 14.0.4 — the list lives in a Worker
 * secret, nowhere in the code) and the direct JioSaavn web API. Server-side
 * pings (no browser CORS variance) with status + latency + whether real
 * songs came back, so a silent-empty-home always has an obvious cause.
 * Admin-gated: this spends the upstreams' quota.
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { onRequestGet as catalogGet, upstreamBases, type CatalogEnv } from '../cat/[[path]]';

type Env = AdminEnv & CatalogEnv;

const QUERY = 'search/songs?query=telugu&limit=1';

interface Mirror { id: string; label: string; base: string }

/** The configured wrappers, labelled by host; the secret holds the URLs. */
function mirrorsOf(env: CatalogEnv): Mirror[] {
  return upstreamBases(env).map((base, i) => {
    let label = base;
    try { label = new URL(base).host; } catch { /* keep */ }
    return { id: `upstream-${i + 1}`, label, base };
  });
}

interface SourceHealth {
  id: string;
  label: string;
  base: string;
  ok: boolean;
  status: number | null;
  ms: number;
  songs: number;
  note: string | null;
  /** 1.3 — the wrapper's own /health report (wrappers only; null when it has none). */
  health?: WrapperHealth | null;
}

/** One upstream as a wrapper's /health names it. Names and numbers only — never its error text. */
interface UpstreamHealth {
  name: string;
  configured: boolean;
  ok: boolean;
  latencyMs: number | null;
}

interface WrapperHealth {
  status: string;
  upstreams: UpstreamHealth[];
}

/**
 * 1.3 — read a wrapper's GET /health ({ data: { status, <name>: { configured,
 * ok, latencyMs, error } } }). Only the shape above is kept; an error string
 * becomes ok: false, never a note (audit M-SRV-5).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseWrapperHealth(j: any): WrapperHealth | null {
  const d = j?.data ?? j;
  if (!d || typeof d !== 'object' || typeof d.status !== 'string') return null;
  const upstreams: UpstreamHealth[] = [];
  for (const [name, v] of Object.entries(d)) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !/^[a-z][a-z0-9_-]{0,31}$/i.test(name)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = v as any;
    if (typeof u.ok !== 'boolean') continue;
    upstreams.push({
      name,
      configured: u.configured !== false,
      ok: u.ok,
      latencyMs: typeof u.latencyMs === 'number' && Number.isFinite(u.latencyMs) ? Math.round(u.latencyMs) : null,
    });
    if (upstreams.length >= 8) break;
  }
  return { status: d.status.slice(0, 16), upstreams };
}

async function wrapperHealth(base: string): Promise<WrapperHealth | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(`${base}/health`, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!r.ok) return null;
    return parseWrapperHealth(await r.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countSongs(j: any): number {
  const results = j?.data?.results ?? j?.results;
  return Array.isArray(results) ? results.length : 0;
}

async function readHealth(
  id: string, label: string, base: string,
  run: () => Promise<Response>,
): Promise<SourceHealth> {
  const t0 = Date.now();
  try {
    const res = await run();
    const ms = Date.now() - t0;
    let songs = 0;
    let parsed = false;
    try {
      songs = countSongs(await res.json());
      parsed = true;
    } catch {
      /* non-JSON body (rate-limit HTML etc.) */
    }
    const ok = res.ok && parsed;
    // Sanitized note only — never echo upstream bodies (see audit M-SRV-5).
    const note = ok ? null : res.ok ? 'non-json body' : `http ${res.status}`;
    return { id, label, base, ok, status: res.status, ms, songs, note };
  } catch {
    return { id, label, base, ok: false, status: null, ms: Date.now() - t0, songs: 0, note: 'network / timeout' };
  }
}

/** The self-hosted catalog, exercised in-process — same code path as the app. */
function pingSelfCatalog(request: Request, env: CatalogEnv): Promise<SourceHealth> {
  const url = new URL(request.url);
  const req = new Request(`${url.origin}/api/cat/${QUERY}`, { headers: { accept: 'application/json' } });
  return readHealth('vinax-cat', 'VinaX Catalog (/api/cat)', `${url.origin}/api/cat`, () =>
    Promise.resolve(catalogGet({ request: req, params: { path: ['search', 'songs'] }, env })),
  );
}

/** The built-in translation alone, with every wrapper taken out of the way. */
function pingDirect(request: Request, env: CatalogEnv): Promise<SourceHealth> {
  const url = new URL(request.url);
  const req = new Request(`${url.origin}/api/cat/${QUERY}`, { headers: { accept: 'application/json' } });
  const direct = env.CATALOG_DIRECT_URL?.trim() || 'https://www.jiosaavn.com/api.php';
  return readHealth('direct', 'Direct (JioSaavn web API)', direct, () =>
    Promise.resolve(catalogGet({ request: req, params: { path: ['search', 'songs'] }, env: { CATALOG_DIRECT_URL: env.CATALOG_DIRECT_URL } })),
  );
}

async function pingMirror(m: Mirror): Promise<SourceHealth> {
  const [search, health] = await Promise.all([
    readHealth(m.id, m.label, m.base, () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      return fetch(`${m.base}/${QUERY}`, { headers: { accept: 'application/json' }, signal: controller.signal })
        .finally(() => clearTimeout(timer));
    }),
    wrapperHealth(m.base),
  ]);
  return { ...search, health };
}

export const onRequestGet = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  const sources = await Promise.all([
    pingSelfCatalog(request, env),
    ...mirrorsOf(env).map(pingMirror),
    pingDirect(request, env),
  ]);
  return new Response(JSON.stringify({ checkedAt: new Date().toISOString(), configured: upstreamBases(env).length, mirrors: sources }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
