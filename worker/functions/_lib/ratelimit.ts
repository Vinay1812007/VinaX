/**
 * Minimal per-isolate token-bucket rate limiter for the unauthenticated AI +
 * feedback endpoints (DQA-05/16). Zero-infra by design: state lives in module
 * memory, so limits apply per Cloudflare isolate (per PoP), not globally —
 * that still turns "loop it from one box and drain the token budget" into a
 * trickle, while real listeners never get close to the caps.
 *
 * TODO(security H-SRV-11): the in-memory bucket store persists only for the
 * lifetime of a single Cloudflare isolate and is invisible to other PoPs, so
 * a coordinated attacker can shard requests across colos to defeat these
 * limits. Migrate to a durable store (Cloudflare KV, Durable Objects, or
 * Upstash) once one is provisioned. Until then, the map key is hashed with a
 * pepper so raw client IPs never sit in memory even for the isolate's
 * lifetime.
 */
interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

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
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const rawPepper = env && typeof env === 'object' ? (env as { TELEMETRY_PEPPER?: unknown }).TELEMETRY_PEPPER : undefined;
  const pepper = typeof rawPepper === 'string' && rawPepper.length > 0 ? rawPepper : 'vinax-default-pepper-set-me';
  const ipKey = hashKey(ip, pepper);
  const key = `${route}|${ipKey}`;
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
