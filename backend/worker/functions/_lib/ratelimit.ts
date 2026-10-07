/**
 * Rate limiting for the unauthenticated AI + feedback + telemetry endpoints
 * (DQA-05/16, security H-SRV-11). Two layers:
 *
 * 1. `rateLimit()` — a per-isolate token bucket in module memory (sync). It
 *    is the burst guard and the whole limiter wherever no binding exists
 *    (unit tests, `wrangler dev` without bindings, a deploy that predates the
 *    wrangler.toml entries). One isolate cannot see another's buckets.
 *
 * 2. `rateLimitAsync()` — the same bucket, THEN the Workers Rate Limiting
 *    binding for the route's tier (`RATE_LIMIT_10` / `_30` / `_60` / `_300`:
 *    requests per 60 s per key, see wrangler.toml). The binding's counters are
 *    shared by every isolate and machine in one Cloudflare location, so
 *    sharding requests across isolates no longer multiplies the limit.
 *
 * What the binding does NOT give (per the platform documentation): limits are
 * per location, not global — a client that reaches several locations gets a
 * budget in each; counters are cached on the local machine and synchronised
 * in the background, so the limit is permissive and eventually consistent (a
 * burst can slightly overshoot it); it is not an accounting system. A binding
 * call that throws fails open to layer 1 and is logged.
 *
 * Keys are `route|hash(ip)`: there are no accounts, so the client address is
 * the only key; the platform advises against IP keys because many people can
 * share one address (carrier NAT). The tiers are therefore set at or above
 * the most one isolate's bucket admits in any 60 s window (capacity + one
 * minute of refill), so the binding never refuses a client the bucket alone
 * would have served; what it removes is the multiplication across isolates.
 * The pepper hash keeps raw client IPs out of memory and out of the key.
 */
interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

/** Tests only: forget every bucket between cases. */
export function _resetRateLimitsForTests(): void {
  buckets.clear();
}

// Any object env accepted; we only look for a TELEMETRY_PEPPER string on it.
// Kept as an opaque type to avoid structural-match errors with caller Env types.
type PepperEnv = object;

/** FNV-1a 64-bit mixed with a pepper, encoded as 16 hex chars. Not
 *  cryptographic, but keeps plaintext IPs out of the in-memory map — an
 *  adversary who somehow read an isolate's memory couldn't back out client
 *  IPs without also knowing TELEMETRY_PEPPER. Sync so callers keep their
 *  existing `const limited = rateLimit(...)` shape. */
function hashKey(input: string, pepper: string): string {
  const s = `${pepper}\x00${input}`;
  // 64-bit FNV-1a implemented as two 32-bit halves to stay inside safe-int.
  let h1 = 0xcbf29ce4 | 0;
  let h2 = 0x84222325 | 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h2 = (h2 ^ c) >>> 0;
    // multiply by FNV prime 0x100000001b3 split across the two halves
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
    h2 = (h2 + h1) >>> 0;
  }
  const hex = (n: number): string => n.toString(16).padStart(8, '0');
  return (hex(h1) + hex(h2)).slice(0, 16);
}

/** Returns a ready-to-send 429 when the caller is over budget, else null. */
export function rateLimit(
  request: Request,
  route: string,
  opts: { capacity?: number; refillPerMinute?: number } = {},
  env?: PepperEnv,
): Response | null {
  const capacity = opts.capacity ?? 20;
  const refillPerMs = (opts.refillPerMinute ?? 10) / 60_000;
  const key = `${route}|${clientKey(request, env)}`;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_BUCKETS) {
      // Housekeeping under flood: drop stale buckets, or start over.
      const cutoff = now - 10 * 60_000;
      for (const [k, v] of buckets) if (v.last < cutoff) buckets.delete(k);
      if (buckets.size >= MAX_BUCKETS) buckets.clear();
    }
    b = { tokens: capacity, last: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(capacity, b.tokens + (now - b.last) * refillPerMs);
  b.last = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return null;
  }
  const retryAfterSec = Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs / 1000));
  return tooMany(retryAfterSec);
}

/** The Workers Rate Limiting binding (`[[ratelimits]]` in wrangler.toml). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Binding tiers: name → requests allowed per 60 s per key. Keep in step with wrangler.toml. */
export const RATE_LIMIT_TIERS = [
  { binding: 'RATE_LIMIT_10', limit: 10 },
  { binding: 'RATE_LIMIT_30', limit: 30 },
  { binding: 'RATE_LIMIT_60', limit: 60 },
  { binding: 'RATE_LIMIT_300', limit: 300 },
] as const;

/**
 * The smallest tier at or above the most one isolate's bucket admits in a
 * 60 s window (capacity + refill per minute). Null when no tier is big
 * enough — that route then relies on the bucket alone.
 */
export function tierFor(opts: { capacity?: number; refillPerMinute?: number } = {}): (typeof RATE_LIMIT_TIERS)[number] | null {
  const need = (opts.capacity ?? 20) + (opts.refillPerMinute ?? 10);
  return RATE_LIMIT_TIERS.find((t) => t.limit >= need) ?? null;
}

function bindingOn(env: object | undefined, name: string): RateLimitBinding | null {
  const b = env ? (env as Record<string, unknown>)[name] : undefined;
  return b && typeof (b as RateLimitBinding).limit === 'function' ? (b as RateLimitBinding) : null;
}

let bindingErrorLogged = false;

/** Ask a rate-limit binding; null when the binding is absent or failed (fail open). */
export async function bindingAllows(env: object | undefined, name: string, key: string): Promise<boolean | null> {
  const binding = bindingOn(env, name);
  if (!binding) return null;
  try {
    const { success } = await binding.limit({ key });
    return success === true;
  } catch (e) {
    // Fail open to the in-memory layer; say so once per isolate.
    if (!bindingErrorLogged) {
      bindingErrorLogged = true;
      console.warn(`[ratelimit] binding ${name} failed — in-memory limits only: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }
}

/** The pepper-hashed client key both layers use. */
export function clientKey(request: Request, env?: PepperEnv): string {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const rawPepper = env && typeof env === 'object' ? (env as { TELEMETRY_PEPPER?: unknown }).TELEMETRY_PEPPER : undefined;
  const pepper = typeof rawPepper === 'string' && rawPepper.length > 0 ? rawPepper : 'vinax-default-pepper-set-me';
  return hashKey(ip, pepper);
}

/**
 * The durable variant: the per-isolate bucket first (burst guard, always on),
 * then the route's Rate Limiting binding tier when one is bound. Returns a
 * ready-to-send 429 or null. Without a binding it behaves exactly like
 * `rateLimit()`.
 */
export async function rateLimitAsync(
  request: Request,
  route: string,
  opts: { capacity?: number; refillPerMinute?: number } = {},
  env?: PepperEnv,
): Promise<Response | null> {
  const local = rateLimit(request, route, opts, env);
  if (local) return local;
  const tier = tierFor(opts);
  if (!tier) return null;
  const allowed = await bindingAllows(env, tier.binding, `${route}|${clientKey(request, env)}`);
  if (allowed !== false) return null;
  // The binding does not say when its fixed window resets; a minute is the
  // honest upper bound.
  return tooMany(60);
}

function tooMany(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: 'rate_limited', retryAfter: retryAfterSec }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'retry-after': String(retryAfterSec),
      'access-control-allow-origin': '*',
    },
  });
}

/** 405 for POST-only routes — otherwise a GET falls through to the SPA shell
 *  and answers 200 HTML (DQA-07). */
export function methodNotAllowed(allow = 'POST, OPTIONS'): Response {
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: {
      'content-type': 'application/json',
      allow,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}
