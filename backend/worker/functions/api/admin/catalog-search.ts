/**
 * Admin-only catalog search proxy. The admin panel's notification composer
 * (and future song/album pickers) needs to search the jiosaavn catalog for
 * a target when composing a push. Previously the admin JS called the saavn
 * mirrors directly from the browser — which was fragile:
 *
 *   - Some mirrors don't set Access-Control-Allow-Origin, so the fetch
 *     works from server but fails from a subdomain browser.
 *   - Mirrors go down for hours at a time (public infra, no SLA).
 *   - The 4-mirror JS fallback exhausted in ~24s, showing an unhelpful
 *     "catalog sources unavailable" message.
 *
 * This proxy sidesteps all of that: same-origin from the admin subdomain,
 * runs the SAME multi-mirror fallback server-side, returns a normalized
 * shape the admin JS renders directly.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { rateLimit } from '../../_lib/ratelimit';

// Same mirror pool the app's client uses. Order matters — first responder wins.
// 5.0.0 sweep: the self-hosted catalog (/api/cat) leads everywhere. saavn.dev
// (DNS dead) and the b4a.run mirror (404s these routes) are dropped — they
// only burned a timeout apiece before the working base was ever tried.
const MIRRORS = [
  'https://www.sirimillavinay.online/api/cat',
  'https://saavn.sumit.co/api',
  'https://nepotuneapi.vercel.app/api',
];

interface RawItem {
  id?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  image?: unknown;
  images?: unknown;
  artists?: { primary?: Array<{ name?: string }> };
  primaryArtists?: string;
  artist?: string;
}

interface NormalizedItem {
  id: string;
  name: string;
  subtitle: string;
  image: string;
}

function pickImage(raw: unknown): string {
  if (Array.isArray(raw) && raw.length) {
    const last = raw[raw.length - 1] as { url?: string; link?: string } | undefined;
    return (last?.url ?? last?.link ?? '') as string;
  }
  return typeof raw === 'string' ? raw : '';
}

function pickSubtitle(it: RawItem): string {
  if (it.subtitle) return it.subtitle;
  const primary = it.artists?.primary;
  if (Array.isArray(primary)) return primary.map((a) => a?.name ?? '').filter(Boolean).join(', ');
  return it.primaryArtists ?? it.artist ?? '';
}

function normalize(list: unknown): NormalizedItem[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((raw): NormalizedItem | null => {
      const it = raw as RawItem;
      if (!it?.id || !(it.name || it.title)) return null;
      return {
        id: String(it.id).slice(0, 128),
        name: String(it.name ?? it.title ?? '').slice(0, 200),
        subtitle: String(pickSubtitle(it) ?? '').slice(0, 200),
        image: String(pickImage(it.image ?? it.images) ?? '').slice(0, 512),
      };
    })
    .filter((x): x is NormalizedItem => x !== null);
}

/** ok=true means the mirror actually responded (2xx JSON) — items may still
 *  be empty for a query with no matches. ok=false means it errored/timed out.
 *  The caller needs this distinction so "no matches" isn't reported as
 *  "sources unavailable". */
async function searchOne(base: string, path: string): Promise<{ ok: boolean; items: NormalizedItem[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(base + path, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, items: [] };
    const j = (await res.json()) as { data?: { results?: unknown[]; songs?: unknown[]; albums?: unknown[] }; results?: unknown[]; songs?: unknown[]; albums?: unknown[] };
    const d = j?.data ?? j ?? {};
    const list = (d as { results?: unknown[]; songs?: unknown[]; albums?: unknown[] }).results
      ?? (d as { songs?: unknown[] }).songs
      ?? (d as { albums?: unknown[] }).albums
      ?? [];
    return { ok: true, items: normalize(list) };
  } catch {
    return { ok: false, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

export const onRequestGet = async (context: { request: Request; env: AdminEnv }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const rl = await rateLimit(request, 'admin-catalog-search', { capacity: 40, refillPerMinute: 40 }, env);
  if (rl) return rl;

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') === 'album' ? 'album' : 'song';
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit') ?? '8')));
  if (!q) return respond({ items: [], source: null, error: 'q_required' }, 400);

  const path = `/search/${kind === 'album' ? 'albums' : 'songs'}?query=${encodeURIComponent(q)}&limit=${limit}`;

  // Server-side multi-mirror fallback — try each in order, first non-empty
  // wins. Crucially, distinguish "a mirror answered but the query has no
  // matches" (200, empty, error:null → admin shows "No matches") from "every
  // mirror errored/timed out" (502 → admin shows "sources unavailable"). The
  // old code returned 502 for BOTH, so a valid short/rare query looked like
  // an outage.
  let anyResponded = false;
  for (const base of MIRRORS) {
    const r = await searchOne(base, path);
    if (r.ok) anyResponded = true;
    if (r.items.length) {
      return respond({ items: r.items, source: new URL(base).hostname, error: null }, 200);
    }
  }
  if (anyResponded) return respond({ items: [], source: null, error: null }, 200);
  return respond({ items: [], source: null, error: 'no_mirrors_responded' }, 502);
};

function respond(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}
