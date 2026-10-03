/**
 * GET /api/geo — privacy-safe COARSE place context from the edge.
 *
 * Cloudflare resolves the visitor's IP as part of normal request handling and
 * hands this Worker a `request.cf` object. We return only the coarse fields a
 * music app can actually use:
 *
 *   country     two-letter code (CF-IPCountry, else cf.country)
 *   region      state / province NAME, when the edge has one
 *   city        the edge's APPROXIMATE city. Often the ISP's exchange rather
 *               than where the listener is, so it is labelled approximate
 *               everywhere it is shown and is never treated as a fact.
 *   timezone    IANA zone the edge associates with the address
 *
 * The IP address itself is NEVER returned, NEVER logged by this function and
 * NEVER stored by VinaX. Nothing here is personalised, so the answer is the
 * same for every visitor from the same place and is safe to cache privately.
 *
 * 9.1.0:
 *   - city and timezone added (9.0 returned country + region only), so local
 *     trends, date/time context and search queries have something to work
 *     with without asking the browser for a location permission;
 *   - CORS added, because the Android shell may call this cross-origin;
 *   - `T1` (Tor) joins `XX` as "unknown", and an obviously non-ISO country is
 *     rejected rather than passed through;
 *   - `source` says where the answer came from, and `unknown: true` says so
 *     plainly when the edge gave us nothing (local dev, a non-Cloudflare
 *     origin, a VPN exit the edge cannot place). The client then falls back to
 *     browser locale / time zone — see src/services/location/inference.ts.
 */
interface CfRequestExtras {
  cf?: { country?: string; region?: string; city?: string; timezone?: string };
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const ISO_COUNTRY = /^[A-Z]{2}$/;
/** An IANA zone: "Asia/Kolkata", "Europe/London", "UTC". */
const IANA_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/** A coarse place name: letters, spaces and the punctuation place names use. */
export function placeName(value: unknown, max = 60): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length > max) return null;
  return /^[\p{L}\p{M}][\p{L}\p{M} .'’\-()]*$/u.test(text) ? text : null;
}

export function readCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  // XX = the edge could not place the address; T1 = the Tor network.
  if (!ISO_COUNTRY.test(code) || code === 'XX' || code === 'T1') return null;
  return code;
}

export function readTimezone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const zone = value.trim();
  return zone.length <= 64 && IANA_ZONE.test(zone) ? zone : null;
}

export interface GeoAnswer {
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  source: 'edge';
  /** True when the edge placed nothing: the client should use browser signals. */
  unknown: boolean;
}

/** Pure: build the answer from a request's edge metadata. */
export function geoAnswer(request: Request): GeoAnswer {
  const cf = (request as Request & CfRequestExtras).cf ?? {};
  const country = readCountry(request.headers.get('CF-IPCountry')) ?? readCountry(cf.country);
  const region = placeName(cf.region);
  const city = placeName(cf.city, 80);
  const timezone = readTimezone(cf.timezone);
  return {
    country,
    // A region or city without a country is not useful context — and would be
    // the only field a misconfigured edge fills.
    region: country ? region : null,
    city: country ? city : null,
    timezone,
    source: 'edge',
    unknown: !country,
  };
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (context: { request: Request }): Promise<Response> =>
  new Response(JSON.stringify(geoAnswer(context.request)), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Per-visitor by definition: never share it between them.
      'cache-control': 'private, no-store',
      ...CORS,
    },
  });
