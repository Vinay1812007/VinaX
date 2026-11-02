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
 *
 * Console rebuild: GET /api/admin/catalog-search?q=&type=songs|albums|artists|playlists&limit=
 *   → { items: [{ id, title, name, subtitle, image, type, language, year, duration, album, preview }], type, source, error }
 * `preview` is a low-bitrate stream of a song; the console plays its first 30 seconds.
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { rateLimitAsync } from '../../_lib/ratelimit';

// Same mirror pool the app's client uses. Order matters — first responder wins.
// 5.0.0 sweep: the self-hosted catalog (/api/cat) leads everywhere. saavn.dev
// (DNS dead) and the b4a.run mirror (404s these routes) are dropped — they
// only burned a timeout apiece before the working base was ever tried.
const MIRRORS = [
  'https://www.vinaxmusic.online/api/cat',
  'https://saavn.sumit.co/api',
  'https://nepotuneapi.vercel.app/api',
];

interface RawItem {
  id?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  type?: string;
  language?: string;
  year?: string | number;
  duration?: number;
  image?: unknown;
  images?: unknown;
  artists?: { primary?: Array<{ name?: string }> };
  primaryArtists?: string;
  artist?: string;
  album?: { id?: string; name?: string };
  downloadUrl?: Array<{ quality?: string; url?: string; bitrate?: number }>;
  songCount?: number | string;
}

/** One search result. `name` is kept for older callers; `title` is the same. */
export interface NormalizedItem {
  id: string;
  name: string;
  title: string;
  subtitle: string;
  image: string;
  type: string;
  language: string | null;
  year: string | null;
  duration: number | null;
  album: { id: string; name: string } | null;
  /** A low-bitrate stream the console plays for 30 seconds (songs only). */
  preview: string | null;
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
  if (Array.isArray(primary) && primary.length) return primary.map((a) => a?.name ?? '').filter(Boolean).join(', ');
  return it.primaryArtists ?? it.artist ?? it.description ?? '';
}

/** The lowest usable bitrate (48 kbps when there) as an https URL. */
function pickPreview(it: RawItem): string | null {
  const list = Array.isArray(it.downloadUrl) ? it.downloadUrl.filter((d) => typeof d?.url === 'string' && /^https:\/\//.test(d.url)) : [];
  if (!list.length) return null;
  const pick = list.find((d) => d.quality === '48kbps') ?? list.find((d) => (d.bitrate ?? 0) >= 48) ?? list[0];
  return String(pick.url).slice(0, 512);
}

export function normalize(list: unknown, type = 'song'): NormalizedItem[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((raw): NormalizedItem | null => {
      const it = raw as RawItem;
      if (!it?.id || !(it.name || it.title)) return null;
      const name = String(it.name ?? it.title ?? '').slice(0, 200);
      const image = String(pickImage(it.image ?? it.images) ?? '').slice(0, 512);
      return {
        id: String(it.id).slice(0, 128),
        name,
        title: name,
        subtitle: String(pickSubtitle(it) ?? '').slice(0, 200),
        image: /^https:\/\//.test(image) ? image : '',
        type: typeof it.type === 'string' && it.type ? it.type : type,
        language: typeof it.language === 'string' && it.language ? it.language.slice(0, 30) : null,
        year: it.year != null && String(it.year) ? String(it.year).slice(0, 8) : null,
        duration: typeof it.duration === 'number' && Number.isFinite(it.duration) ? it.duration : null,
        album: it.album?.id ? { id: String(it.album.id).slice(0, 128), name: String(it.album.name ?? '').slice(0, 200) } : null,
        preview: type === 'song' ? pickPreview(it) : null,
      };
    })
    .filter((x): x is NormalizedItem => x !== null);
}

/** ok=true means the mirror actually responded (2xx JSON) — items may still
 *  be empty for a query with no matches. ok=false means it errored/timed out.
 *  The caller needs this distinction so "no matches" isn't reported as
 *  "sources unavailable". */
async function searchOne(base: string, path: string, type: string): Promise<{ ok: boolean; items: NormalizedItem[] }> {
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
    return { ok: true, items: normalize(list, type) };
  } catch {
    return { ok: false, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

export const onRequestGet = async (context: { request: Request; env: AdminEnv }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  const rl = await rateLimitAsync(request, 'admin-catalog-search', { capacity: 40, refillPerMinute: 40 }, env);
  if (rl) return rl;

  const url = new URL(request.url);
  // type=songs|albums|artists|playlists (the console's pickers); kind=song|album kept for older callers.
  const t = url.searchParams.get('type');
  const type = t === 'albums' || t === 'artists' || t === 'playlists' || t === 'songs' ? t : url.searchParams.get('kind') === 'album' ? 'albums' : 'songs';
  const one = type.slice(0, -1);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit') ?? '8') || 8));
  if (!q) return respond({ items: [], type, source: null, error: 'q_required' }, 400);

  const path = `/search/${type}?query=${encodeURIComponent(q)}&limit=${limit}`;

  // Server-side multi-mirror fallback — try each in order, first non-empty
  // wins. Crucially, distinguish "a mirror answered but the query has no
  // matches" (200, empty, error:null → admin shows "No matches") from "every
  // mirror errored/timed out" (502 → admin shows "sources unavailable"). The
  // old code returned 502 for BOTH, so a valid short/rare query looked like
  // an outage.
  let anyResponded = false;
  for (const base of MIRRORS) {
    const r = await searchOne(base, path, one);
    if (r.ok) anyResponded = true;
    if (r.items.length) {
      return respond({ items: r.items, type, source: new URL(base).hostname, error: null }, 200);
    }
  }
  if (anyResponded) return respond({ items: [], type, source: null, error: null }, 200);
  return respond({ items: [], type, source: null, error: 'no_mirrors_responded' }, 502);
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
