/**
 * Live health check for every music catalog source: the self-hosted
 * /api/cat catalog (checked in-process — the exact handler the app uses,
 * wrappers and any direct translation included), then each configured
 * wrapper on its own (CATALOG_UPSTREAMS — the list lives in a Worker
 * secret, nowhere in the code) and, when CATALOG_DIRECT_URL is set, the
 * direct JioSaavn web API. Server-side
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

/** The optional direct translation alone (CATALOG_DIRECT_URL), with every wrapper taken out of the way. */
function pingDirect(request: Request, env: CatalogEnv): Promise<SourceHealth> {
  const url = new URL(request.url);
  const req = new Request(`${url.origin}/api/cat/${QUERY}`, { headers: { accept: 'application/json' } });
  const direct = env.CATALOG_DIRECT_URL?.trim() ?? '';
  return readHealth('direct', 'Direct (JioSaavn web API)', direct, () =>
    Promise.resolve(catalogGet({ request: req, params: { path: ['search', 'songs'] }, env: { CATALOG_DIRECT_URL: env.CATALOG_DIRECT_URL } })),
  );
}

function pingMirror(m: Mirror): Promise<SourceHealth> {
  return readHealth(m.id, m.label, m.base, () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    return fetch(`${m.base}/${QUERY}`, { headers: { accept: 'application/json' }, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  });
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
    ...(env.CATALOG_DIRECT_URL?.trim() ? [pingDirect(request, env)] : []),
  ]);
  return new Response(JSON.stringify({ checkedAt: new Date().toISOString(), configured: upstreamBases(env).length, mirrors: sources }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
