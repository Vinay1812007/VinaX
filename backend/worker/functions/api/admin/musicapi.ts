/**
 * Live health check for every music catalog source: the self-hosted
 * /api/cat catalog (checked in-process — the exact handler the app uses,
 * including its JioSaavn upstream) plus the community JioSaavn mirrors in
 * the historical fallback ladder. Server-side pings (no browser CORS
 * variance) with status + latency + whether real songs came back, so a
 * silent-empty-home always has an obvious cause. Admin-gated: external
 * mirrors are community services and this spends their quota.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { onRequestGet as catalogGet } from '../cat/[[path]]';

type Env = AdminEnv;

const QUERY = 'search/songs?query=telugu&limit=1';

const MIRRORS = [
  // v5.6.6 — the owner's own hosted wrapper (Render free tier: expect a slow
  // first ping after idle; that cold-start showing here is the honest truth).
  { id: 'vinax-render', label: 'vinax-saavan-api.onrender.com', base: 'https://vinax-saavan-api.onrender.com/api' },
  { id: 'saavn-sumit', label: 'saavn.sumit.co', base: 'https://saavn.sumit.co/api' },
  { id: 'saavn-dev', label: 'saavn.dev', base: 'https://saavn.dev/api' },
  { id: 'nepotune', label: 'nepotuneapi.vercel.app', base: 'https://nepotuneapi.vercel.app/api' },
  { id: 'b4a', label: 'jiosaavn-api-privatecv8.b4a.run', base: 'https://jiosaavn-api-privatecv8.b4a.run/api' },
] as const;

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
function pingSelfCatalog(request: Request): Promise<SourceHealth> {
  const url = new URL(request.url);
  const req = new Request(`${url.origin}/api/cat/${QUERY}`, { headers: { accept: 'application/json' } });
  return readHealth('vinax-cat', 'VinaX Catalog (/api/cat)', `${url.origin}/api/cat`, () =>
    Promise.resolve(catalogGet({ request: req, params: { path: ['search', 'songs'] } })),
  );
}

function pingMirror(m: (typeof MIRRORS)[number]): Promise<SourceHealth> {
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
  if (!isAdmin(request, env)) return unauthorized();
  const sources = await Promise.all([
    pingSelfCatalog(request),
    ...MIRRORS.map(pingMirror),
  ]);
  return new Response(JSON.stringify({ checkedAt: new Date().toISOString(), mirrors: sources }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
