/**
 * Cross-origin access for the API host (api.vinaxmusic.online).
 *
 * On the Worker the app called `/api/*` on its own origin (www), so most
 * routes never needed CORS. Since the app sends `/api/*` to the API host
 * (frontend/src/apiHost.ts), every call is cross-origin. Rather than give each
 * route its own CORS code, the server answers here for the app's origins:
 *
 * - a preflight (OPTIONS with Access-Control-Request-Method) is answered at
 *   once with the methods and the exact headers the browser asked for, cached
 *   for a day, without reaching the route;
 * - any other answer gets Access-Control-Allow-Origin (when the route did not
 *   set one), Vary: Origin and Access-Control-Expose-Headers: * so the app can
 *   still read headers such as retry-after.
 *
 * The app authenticates with a Bearer token, never cookies, so no
 * Access-Control-Allow-Credentials. Other origins get no CORS headers at all,
 * as before.
 */

export const APP_ORIGINS: ReadonlySet<string> = new Set([
  'https://www.vinaxmusic.online',
  'https://vinaxmusic.online',
  'https://admin.vinaxmusic.online',
  // Capacitor shells (the Android app loads www, but older shells used these).
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
]);
const LOOPBACK_DEV = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

const METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';

/** The Origin to echo back, or null when the origin gets no CORS answer. */
export function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return APP_ORIGINS.has(origin) || LOOPBACK_DEV.test(origin) ? origin : null;
}

/** The answer to a CORS preflight from an app origin, else null. */
export function preflight(request: Request): Response | null {
  if (request.method !== 'OPTIONS' || !request.headers.has('access-control-request-method')) return null;
  const origin = allowedOrigin(request.headers.get('origin'));
  if (!origin) return null;
  const headers: Record<string, string> = {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': METHODS,
    'access-control-max-age': '86400',
    vary: 'Origin, Access-Control-Request-Headers',
    'cache-control': 'no-store',
  };
  const asked = request.headers.get('access-control-request-headers');
  if (asked) headers['access-control-allow-headers'] = asked;
  return new Response(null, { status: 204, headers });
}

/** Headers to add to a route's answer for a request from `origin`. */
export function corsAdditions(origin: string | null, existing: Headers): Array<[string, string]> {
  const allowed = allowedOrigin(origin);
  if (!allowed) return [];
  const out: Array<[string, string]> = [];
  if (!existing.has('access-control-allow-origin')) out.push(['access-control-allow-origin', allowed]);
  if (!existing.has('access-control-expose-headers')) out.push(['access-control-expose-headers', '*']);
  const vary = existing.get('vary');
  if (!vary || !/(^|,)\s*(origin|\*)\s*(,|$)/i.test(vary)) out.push(['vary', 'Origin']);
  return out;
}
