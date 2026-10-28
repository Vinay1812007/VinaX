/**
 * 11.0 — the guard in front of the edge-rendered catalogue pages
 * (/song, /album, /artist, /playlist and the language-mood hubs).
 *
 * Why: on 2026-10-06 an HTML scraper rotating fake desktop-browser user
 * agents across thousands of IPv6 addresses (about ten requests per address,
 * a handful of /32 prefixes) fetched entity pages around the clock — ~98% of
 * the day's Worker requests, the free daily quota gone by mid-morning, and
 * every page costing three to five catalogue subrequests. Nobody was using
 * the app; the Worker was busy rendering pages for a robot.
 *
 * What this can and cannot do. A request on a Worker route invokes the Worker
 * before any cache, so code cannot make such a request free: only a WAF rule
 * at the zone edge stops it from counting (see backend/scripts/cf-edge-rules.mjs
 * and docs/operations.md "Scraper traffic on entity pages"). What code CAN do
 * is make the robot's request as cheap as possible and useless to it:
 *
 *  1. A browser impostor — a user agent that claims a Chromium browser but
 *     sends none of the client-hint / fetch-metadata headers every real
 *     Chromium has sent for years — gets the plain app shell at once: no
 *     catalogue lookups, no rendered content, one asset fetch.
 *  2. A network that reads entity pages faster than people do (per address,
 *     and per IPv6 /32 for a rotating pool) is served the same plain shell
 *     once it passes the budget. The shell is the ordinary app: a person who
 *     ever hits the budget still gets a working page, they just lose the
 *     pre-rendered text for that load. Search engines and link previewers
 *     are exempt, so indexing and shared-link cards are untouched.
 *
 * Nothing here looks at who the visitor is: addresses are hashed with the
 * telemetry pepper before they become a key, exactly as the API limiter does.
 */
import { bindingAllows, clientKey, rateLimit, tierFor } from './ratelimit';

type GuardEnv = object & { TELEMETRY_PEPPER?: string };

/** The paths the Worker renders for search engines; everything else is the API or static. */
export function isEntityPage(pathname: string): boolean {
  return /^\/(song|album|artist|playlist)\/[^/]+\/?$/.test(pathname);
}

/** A hub such as /telugu-sad-songs (rendered by [hub].ts). */
export function isHubPage(pathname: string): boolean {
  return /^\/[a-z]+-[a-z]+-songs\/?$/.test(pathname) || /^\/[a-z]+-songs\/?$/.test(pathname);
}

/**
 * Crawlers and previewers that may read every page as fast as they like.
 * Matching the user agent is enough here: the point of the guard is to
 * stop robots that pretend to be browsers, not robots that say what they
 * are. `cf.verifiedBotCategory` (set by the platform for verified crawlers)
 * is honoured too when present.
 */
const KNOWN_CRAWLER = /googlebot|bingbot|duckduckbot|applebot|yandex|baiduspider|petalbot|slurp|facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|slackbot|skypeuripreview|pinterest|embedly|redditbot|ia_archiver|semrushbot|ahrefsbot|mj12bot|uptimerobot|vinax-admin/i;

export function isKnownCrawler(request: Request): boolean {
  const cf = (request as Request & { cf?: { verifiedBotCategory?: unknown } }).cf;
  if (cf && typeof cf.verifiedBotCategory === 'string' && cf.verifiedBotCategory.length > 0) return true;
  return KNOWN_CRAWLER.test(request.headers.get('user-agent') ?? '');
}

/**
 * A user agent that names a Chromium-family browser without the headers that
 * browser always sends. Real Chromium (Chrome, Edge, Opera, Samsung Internet,
 * Android WebView, Brave) has sent `sec-ch-ua` and `sec-fetch-mode` on every
 * navigation since 2020; browsers that do not (Safari, Firefox, Chrome on
 * iOS) do not put "Chrome/" in their user agent. Both headers missing on a
 * "Chrome/" agent is a script.
 */
export function isBrowserImpostor(request: Request): boolean {
  const ua = request.headers.get('user-agent') ?? '';
  if (!/\bChrome\/\d/.test(ua)) return false;
  const h = request.headers;
  return !h.has('sec-ch-ua') && !h.has('sec-fetch-mode') && !h.has('sec-fetch-dest');
}

/** The coarse network a client address belongs to: IPv4 /24, IPv6 /32. */
export function networkOf(ip: string): string {
  if (ip.includes(':')) {
    // Expand "::" enough to read the first two hextets.
    const [head] = ip.split('::');
    const parts = head.split(':').filter(Boolean);
    return `${parts[0] ?? '0'}:${parts[1] ?? '0'}::/32`;
  }
  const o = ip.split('.');
  return o.length === 4 ? `${o[0]}.${o[1]}.${o[2]}.0/24` : ip;
}

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/** Per address: the in-memory bucket plus the shared binding tier (60 / min). */
const ADDRESS_BUDGET = { capacity: 30, refillPerMinute: 30 };
/** Per network: a looser budget, shared by everyone behind one prefix. */
const NETWORK_BUDGET = { capacity: 200, refillPerMinute: 100 };

export type GuardVerdict = 'render' | 'impostor' | 'address' | 'network';

/**
 * Decide how to serve an entity-page request. 'render' means the normal
 * edge-rendered page; anything else means the plain shell. Fails open:
 * a limiter error never costs a visitor the page.
 */
export async function guardVerdict(request: Request, env: GuardEnv | undefined): Promise<GuardVerdict> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return 'render';
  if (isKnownCrawler(request)) return 'render';
  if (isBrowserImpostor(request)) return 'impostor';
  try {
    // The address budget: the API limiter's own key (pepper-hashed address).
    if (rateLimit(request, 'page', ADDRESS_BUDGET, env)) return 'address';
    const addrTier = tierFor(ADDRESS_BUDGET);
    if (addrTier && (await bindingAllows(env, addrTier.binding, `page|${clientKey(request, env)}`)) === false) return 'address';
    // The network budget: a rotating pool shares one prefix.
    const net = networkOf(clientIp(request));
    const netReq = new Request(request.url, { headers: { 'cf-connecting-ip': net } });
    if (rateLimit(netReq, 'pagenet', NETWORK_BUDGET, env)) return 'network';
    const netTier = tierFor(NETWORK_BUDGET);
    if (netTier && (await bindingAllows(env, netTier.binding, `pagenet|${clientKey(netReq, env)}`)) === false) return 'network';
  } catch {
    return 'render';
  }
  return 'render';
}

/**
 * The plain app shell, served in place of a rendered page. Never cacheable:
 * a shared cache keys on the URL alone, so a cached shell would be handed to
 * the next visitor — or crawler — asking for the same song. Marked with a
 * header so the response can be told apart in logs.
 */
export async function plainShell(request: Request, fetchAsset: (req: Request) => Promise<Response>, verdict: GuardVerdict): Promise<Response> {
  const shell = await fetchAsset(new Request(new URL('/index.html', request.url).toString(), { headers: { accept: 'text/html' } }));
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-vinax-page': verdict,
  });
  return new Response(shell.body, { status: 200, headers });
}
