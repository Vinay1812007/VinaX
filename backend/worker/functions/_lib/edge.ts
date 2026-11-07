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

export type DeviceOs = 'android' | 'ios' | 'ipados' | 'macos' | 'windows' | 'chromeos' | 'linux';
export interface DeviceFacts { os: DeviceOs | null; browser: string | null; androidVersion: string | null; webView: boolean }

/**
 * The system and browser in a user agent. iPad Safari usually presents itself
 * as a Mac ("Macintosh"), so most iPads read as macOS: nothing on the server
 * can tell them apart. The Android app is a WebView (`; wv)`).
 */
export function deviceOf(ua: string | null | undefined): DeviceFacts {
  const u = (ua ?? '').slice(0, 512);
  const android = /Android (\d+(?:\.\d+)?)/.exec(u);
  const os: DeviceOs | null = /iPhone|iPod/.test(u) ? 'ios'
    : /iPad/.test(u) ? 'ipados'
      : /Android/.test(u) ? 'android'
        : /Windows NT/.test(u) ? 'windows'
          : /CrOS/.test(u) ? 'chromeos'
            : /Mac OS X|Macintosh/.test(u) ? 'macos'
              : /Linux/.test(u) ? 'linux' : null;
  const browser = /Edg(e|A|iOS)?\//.test(u) ? 'Edge'
    : /OPR\/|Opera/.test(u) ? 'Opera'
      : /SamsungBrowser/.test(u) ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(u) ? 'Firefox'
          : /Chrome\/|CriOS/.test(u) ? 'Chrome'
            : /Safari\//.test(u) && /Version\//.test(u) ? 'Safari' : null;
  return { os, browser, androidVersion: android ? android[1] : null, webView: !!android && /; wv\)/.test(u) };
}

/** Schema 16 — the phone in a user agent: system version, model and maker. */
export interface PhoneFacts { osVersion: string | null; model: string | null; brand: string | null }

/** Model-number prefixes → maker, for the phones VinaX listeners use most. */
const BRANDS: ReadonlyArray<[RegExp, string]> = [
  [/^(SM-|GT-|Galaxy)|samsung/i, 'Samsung'],
  [/^Pixel/i, 'Google'],
  [/^RMX/i, 'Realme'],
  [/^(CPH|OPPO|PH[A-Z]M)/i, 'Oppo / OnePlus'],
  [/^(IN|LE|KB|NE|HD|GM|AC|BE|EB|DN)\d{4}|OnePlus/i, 'OnePlus'],
  [/^I\d{4}|iQOO/i, 'iQOO'],
  [/^V\d{4}|vivo/i, 'Vivo'],
  [/^(Redmi|POCO|Mi |MI |Xiaomi|M\d{4}[A-Z]|2\d{3}[A-Z0-9]{3,})/i, 'Xiaomi'],
  [/^moto|Motorola|^XT\d{4}/i, 'Motorola'],
  [/Infinix/i, 'Infinix'],
  [/TECNO/i, 'Tecno'],
  [/^itel/i, 'itel'],
  [/Nokia|^TA-\d{4}/i, 'Nokia'],
  [/^(A\d{3}|Nothing)/, 'Nothing'],
  [/^LAVA|^LXX/i, 'Lava'],
  [/HUAWEI|^(ELE|VOG|ANA|MAR)-/i, 'Huawei'],
  [/HONOR|^(RMO|CRT|ALI)-/i, 'Honor'],
  [/^(ASUS|ASUS_)/i, 'Asus'],
  [/^LM-|LG-/i, 'LG'],
];

/**
 * Schema 16 — the system version and, on Android, the phone model. The
 * Android app's WebView still names the model ("Android 14; SM-S918B
 * Build/…; wv"); Chrome's reduced user agent says "Android 10; K", which
 * means the model (and often the real version) is hidden: unknown. iPhones
 * never share their model.
 */
export function phoneOf(ua: string | null | undefined): PhoneFacts {
  const u = (ua ?? '').slice(0, 512);
  const ios = /(?:iPhone|CPU) OS (\d+)(?:_(\d+))?/.exec(u);
  if (ios && /iPhone|iPad|iPod/.test(u)) return { osVersion: ios[2] ? `${ios[1]}.${ios[2]}` : ios[1], model: null, brand: 'Apple' };
  const m = /Android (\d+(?:\.\d+)?)(?:;\s*([^;)]*))?/.exec(u);
  if (!m) return { osVersion: null, model: null, brand: null };
  const reduced = /^K$/.test((m[2] ?? '').trim());
  let model: string | null = (m[2] ?? '').replace(/\s*Build\/.*$/, '').trim() || null;
  if (model && (reduced || /^(wv|Mobile|Linux|[a-z]{2}[-_][a-z]{2}|U)$/i.test(model))) model = null;
  if (model) model = model.slice(0, 40);
  const brand = model ? BRANDS.find(([re]) => re.test(model as string))?.[1] ?? null : null;
  // Reduced agents freeze the version at 10: not the phone's real one.
  return { osVersion: reduced ? null : m[1], model, brand };
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
