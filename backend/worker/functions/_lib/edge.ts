/**
 * What the edge knows about a request, in the coarse form the database keeps:
 * country (ISO-2), region and city from Cloudflare — never the IP — plus the
 * app headers (platform, version) and small string helpers every route uses.
 */

export interface EdgeGeo {
  country: string | null;
  region: string | null;
  city: string | null;
}

interface CfRequest extends Request {
  cf?: { country?: string; region?: string; city?: string };
}

/** Cloudflare's edge geo for the request. 'XX' / 'T1' (unknown, Tor) read as unknown. */
export function edgeGeo(request: Request): EdgeGeo {
  const cf = (request as CfRequest).cf ?? {};
  const header = request.headers.get('cf-ipcountry');
  const raw = header && header !== 'XX' && header !== 'T1' ? header : cf.country;
  const country = raw && /^[A-Z]{2}$/i.test(raw) && raw.toUpperCase() !== 'XX' && raw.toUpperCase() !== 'T1' ? raw.toUpperCase() : null;
  return { country, region: clip(cf.region, 80), city: clip(cf.city, 80) };
}

export const PLATFORMS = ['web', 'android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** A platform name the app sent (body or `x-vinax-platform`), else 'web'. */
export function platformOf(raw: unknown, request?: Request): Platform {
  const v = (typeof raw === 'string' ? raw : request?.headers.get('x-vinax-platform') ?? '').trim().toLowerCase();
  return (PLATFORMS as readonly string[]).includes(v) ? (v as Platform) : 'web';
}

/** The app build (body `appVersion` or `x-vinax-version`), clipped. */
export function appVersionOf(raw: unknown, request?: Request): string | null {
  return clip(typeof raw === 'string' ? raw : request?.headers.get('x-vinax-version'), 24);
}

/** A trimmed string of at most `max` characters, or null when empty / not a string. */
export function clip(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** A finite integer inside [min, max], else null. */
export function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i < min || i > max ? null : i;
}

/** `?days=` style window: 1..max, default when absent or malformed. */
export function daysParam(url: URL, fallback = 7, max = 90): number {
  return intIn(url.searchParams.get('days'), 1, max) ?? fallback;
}

/** A JSON object, or null for anything else. */
export function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** JSON answer with no-store caching and the given CORS headers. */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

/** The app's song object, reduced to what the database keeps. */
export interface SongFacts {
  id: string | null;
  title: string | null;
  artist: string | null;
  image: string | null;
  language: string | null;
}

export function songFacts(raw: unknown): SongFacts | null {
  const s = asObject(raw);
  if (!s) return null;
  const image = clip(s.image, 500);
  return {
    id: clip(s.id, 64),
    title: clip(s.title, 200),
    artist: clip(s.artist ?? s.subtitle, 200),
    image: image && /^https:\/\//.test(image) ? image : null,
    language: clip(s.language, 40)?.toLowerCase() ?? null,
  };
}
