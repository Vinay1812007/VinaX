/**
 * The API host (2026-11-18): every `/api/*` call goes to api.vinaxmusic.online.
 *
 * The API moved from the Cloudflare Worker (free plan: 100,000 requests a day,
 * then every `/api/*` call fails until 00:00 UTC) to a server with no daily
 * limit, reached through a Cloudflare Tunnel at api.vinaxmusic.online
 * (README.md (Operations), "Running the API on a server"). The app makes its
 * API calls in ~250 places, as `/api/...` or `https://www.vinaxmusic.online/api/...`;
 * rather than touch each one, this module — imported by main.tsx right after
 * apexRedirect, before anything else can call fetch — sends them to the API
 * host. The Android app loads this same page from www, so it switches too.
 *
 * - Only on the real site (www / apex). Local dev, previews and the e2e
 *   harness keep their own origin.
 * - `/api/apk` (a 13 MB download) and `/api/push/unsubscribe` (refuses other
 *   origins on purpose) stay on the site's origin, i.e. the Worker.
 * - If the API host cannot be reached (network error, or Cloudflare's own
 *   "origin down" page), the call is sent again to the site's origin, and for
 *   the next minute calls go there directly, so a stopped server degrades to
 *   the Worker instead of failing.
 */

export const API_ORIGIN = 'https://api.vinaxmusic.online';

const SITE_ORIGINS: ReadonlySet<string> = new Set(['https://www.vinaxmusic.online', 'https://vinaxmusic.online']);
const STAY_ON_SITE = /^\/api\/(apk|push\/unsubscribe)(\/|$)/;
/** Statuses Cloudflare answers itself when the server behind the tunnel is unreachable. */
const DOWN_STATUSES: ReadonlySet<number> = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);
export const FALLBACK_MS = 60_000;

/** The API-host URL for `raw` (resolved against `base`), or null to leave it alone. */
export function apiUrlFor(raw: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (!SITE_ORIGINS.has(u.origin) || !u.pathname.startsWith('/api/') || STAY_ON_SITE.test(u.pathname)) return null;
  return API_ORIGIN + u.pathname + u.search;
}

/** True when `res` is Cloudflare's own error page, not an answer from the API (which answers JSON or a stream). */
export function hostDown(res: Response): boolean {
  if (!DOWN_STATUSES.has(res.status)) return false;
  const type = res.headers.get('content-type') ?? '';
  return !/json|event-stream/i.test(type);
}

type FetchFn = typeof fetch;
type BeaconFn = (url: string | URL, data?: BodyInit | null) => boolean;

interface HostWindow {
  location: { origin: string; href: string };
  fetch: FetchFn;
  navigator?: { sendBeacon?: BeaconFn };
}

const aborted = (init: RequestInit | undefined, e: unknown): boolean =>
  !!init?.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError');

/**
 * Wrap `win.fetch` (and `navigator.sendBeacon`) so `/api/*` goes to the API host.
 * Answers whether it did anything (false off the real site).
 */
export function installApiHost(win: HostWindow, now: () => number = Date.now): boolean {
  if (!SITE_ORIGINS.has(win.location.origin)) return false;
  const native: FetchFn = win.fetch.bind(win);
  let siteUntil = 0;

  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Request objects (none in the app today) pass through untouched.
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : null;
    const target = raw === null ? null : apiUrlFor(raw, win.location.href);
    if (!target || now() < siteUntil) return native(input, init);
    // A streamed body can be sent only once: no second try for it.
    const retryable = !(typeof ReadableStream !== 'undefined' && init?.body instanceof ReadableStream);
    let res: Response;
    try {
      res = await native(target, init);
    } catch (e) {
      if (!retryable || aborted(init, e)) throw e;
      const viaSite = await native(input, init);
      siteUntil = now() + FALLBACK_MS;
      return viaSite;
    }
    if (!retryable || !hostDown(res)) return res;
    try {
      const viaSite = await native(input, init);
      siteUntil = now() + FALLBACK_MS;
      return viaSite;
    } catch {
      return res;
    }
  };
  win.fetch = wrapped as FetchFn;

  const beacon = win.navigator?.sendBeacon;
  if (win.navigator && typeof beacon === 'function') {
    const nativeBeacon = beacon.bind(win.navigator);
    win.navigator.sendBeacon = (url, data) => {
      const target = now() < siteUntil ? null : apiUrlFor(String(url), win.location.href);
      return nativeBeacon(target ?? url, data);
    };
  }
  return true;
}

if (typeof window !== 'undefined') installApiHost(window);
