/**
 * 12.2 — optional Google sign-in.
 *
 * The app gets a Google ID token (Google's button on the web, the native
 * sign-in sheet on Android) and sends it to POST /api/auth/google. This module
 * checks that token itself — Google's RS256 signature against Google's
 * published keys, the issuer, the audience (GOOGLE_CLIENT_ID, the project's
 * public web client id) and the expiry — then issues VinaX's own session: a
 * small HMAC-signed token the app sends back as `Authorization: Bearer …`.
 * No password, no third-party SDK on the server, nothing stored but the
 * account row (see api/auth/google.ts).
 */

export interface AuthEnv {
  /** Plain var: the web OAuth client id(s), comma-separated. Public. */
  GOOGLE_CLIENT_ID?: string;
  /** Secret that signs sessions; falls back to DEVICE_ID_SECRET, then TELEMETRY_PEPPER. */
  AUTH_SECRET?: string;
  DEVICE_ID_SECRET?: string;
  TELEMETRY_PEPPER?: string;
}

export interface GoogleProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const SKEW_S = 60;
export const SESSION_TTL_S = 30 * 24 * 3600;

// ------------------------------------------------------------------ base64url

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const textToB64url = (t: string): string => bytesToB64url(new TextEncoder().encode(t));
const b64urlToText = (s: string): string => new TextDecoder().decode(b64urlToBytes(s));

// ------------------------------------------------------------------ Google's keys

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let jwks: { at: number; ttl: number; keys: Jwk[] } | null = null;

/** Tests only. */
export function resetGoogleKeys(): void {
  jwks = null;
}

async function googleKeys(now: number): Promise<Jwk[]> {
  if (jwks && now - jwks.at < jwks.ttl) return jwks.keys;
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  jwks = { at: now, ttl: Math.min(Math.max(maxAge, 300), 24 * 3600) * 1000, keys: Array.isArray(body.keys) ? body.keys : [] };
  return jwks.keys;
}

/** The allowed audiences: GOOGLE_CLIENT_ID, comma-separated. */
export function clientIds(env: AuthEnv): string[] {
  return (env.GOOGLE_CLIENT_ID ?? '').split(',').map((s) => s.trim()).filter((s) => /^[\w.-]+\.apps\.googleusercontent\.com$/.test(s));
}

/** A Google ID token → the profile, or null when anything about it is wrong. Never throws. */
export async function verifyGoogleIdToken(env: AuthEnv, token: unknown, now = Date.now()): Promise<GoogleProfile | null> {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(b64urlToText(parts[0])) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    const aud = clientIds(env);
    if (!aud.length) return null;
    let keys = await googleKeys(now);
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) {
      // Google rotated its keys since the cache was filled: read them once more.
      jwks = null;
      keys = await googleKeys(now);
      jwk = keys.find((k) => k.kid === header.kid);
    }
    if (!jwk || jwk.kty !== 'RSA') return null;
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const p = JSON.parse(b64urlToText(parts[1])) as Record<string, unknown>;
    const t = Math.floor(now / 1000);
    if (!ISSUERS.has(String(p.iss))) return null;
    if (typeof p.aud !== 'string' || !aud.includes(p.aud)) return null;
    if (typeof p.exp !== 'number' || p.exp + SKEW_S < t) return null;
    if (typeof p.iat === 'number' && p.iat - SKEW_S > t) return null;
    if (typeof p.sub !== 'string' || !/^\d{1,40}$/.test(p.sub)) return null;
    const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const picture = str(p.picture, 500);
    return {
      sub: p.sub,
      email: str(p.email, 254),
      emailVerified: p.email_verified === true || p.email_verified === 'true',
      name: str(p.name, 80),
      picture: picture && /^https:\/\//.test(picture) ? picture : null,
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ VinaX sessions

const sessionSecret = (env: AuthEnv): string | null => env.AUTH_SECRET?.trim() || env.DEVICE_ID_SECRET?.trim() || env.TELEMETRY_PEPPER?.trim() || null;

async function hmac(secret: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(`session:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToB64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text))));
}

/** A session for this Google account: `vx1.<payload>.<signature>`, valid 30 days. Null without a signing secret. */
export async function issueSession(env: AuthEnv, sub: string, now = Date.now()): Promise<string | null> {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const iat = Math.floor(now / 1000);
  const payload = textToB64url(JSON.stringify({ sub, iat, exp: iat + SESSION_TTL_S }));
  return `vx1.${payload}.${await hmac(secret, payload)}`;
}

/** The Google account id a session belongs to, or null (forged, expired, malformed). */
export async function readSession(env: AuthEnv, token: unknown, now = Date.now()): Promise<string | null> {
  try {
    const secret = sessionSecret(env);
    if (!secret || typeof token !== 'string' || token.length > 600) return null;
    const m = /^vx1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
    if (!m) return null;
    const want = await hmac(secret, m[1]);
    if (want.length !== m[2].length) return null;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
    if (diff !== 0) return null;
    const p = JSON.parse(b64urlToText(m[1])) as { sub?: unknown; exp?: unknown };
    if (typeof p.sub !== 'string' || typeof p.exp !== 'number' || p.exp < Math.floor(now / 1000)) return null;
    return p.sub;
  } catch {
    return null;
  }
}

/** `Authorization: Bearer vx1…` → the token, or ''. */
export function bearer(request: Request): string {
  const h = request.headers.get('authorization') ?? '';
  return /^Bearer\s+(\S+)$/i.exec(h)?.[1] ?? '';
}
