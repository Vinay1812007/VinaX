/**
 * Device identity resolution shared by /api/events and /api/username.
 *
 * Order of trust:
 *   1. A valid HMAC-signed id the server issued earlier (`signed_device_id`)
 *      — the device has PROVED it is the same client. Always wins.
 *   2. The client's own random install id (`deviceId`, a UUID minted once per
 *      browser/app and never shared). It is not trusted as a key: the server
 *      id is HMAC(secret, "client|<uuid>"), so a row can only be joined by a
 *      party that knows that exact uuid — the same bar as the signed token.
 *      Two browsers behind one NAT have different uuids, so they never merge.
 *   3. Nothing usable → a FRESH random id. Never the ip+user-agent hash: that
 *      hash merged every client on one network + browser build into one row,
 *      so a second listener's username claim silently overwrote the first.
 *      (`legacyNetworkFallback` keeps the old derivation available for the
 *      telemetry path only, where pre-uuid clients would otherwise create a
 *      new row per event.)
 *
 * Whatever is resolved, an unverified client is handed a signed id to store
 * and echo next time (`issued`), which upgrades it to case 1 permanently.
 * Existing signed ids — including legacy ip+ua-derived `s_` ids — keep
 * verifying, so no listener loses their row.
 */
import { deriveServerDeviceId, signDeviceId, verifyDeviceId } from './deviceid';

export interface IdentityEnv {
  DEVICE_ID_SECRET?: string;
  TELEMETRY_PEPPER?: string;
}

export type IdentitySource = 'signed' | 'client' | 'fresh' | 'network';

export interface ResolvedIdentity {
  deviceId: string;
  /** Signed id to hand back so the client can prove itself next time; null when it already did. */
  issued: string | null;
  verified: boolean;
  source: IdentitySource;
}

export const identitySecret = (env: IdentityEnv): string =>
  env.DEVICE_ID_SECRET ?? env.TELEMETRY_PEPPER ?? 'vinax-default-pepper-set-me';

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** The client's install uuid, or null when absent / malformed. */
export function clientInstallId(raw: unknown): string | null {
  return typeof raw === 'string' && CLIENT_ID_RE.test(raw) ? raw : null;
}

const hex = (bytes: Uint8Array, n: number): string => {
  let out = '';
  for (let i = 0; i < n; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
};

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg))), 16);
}

/** Stable per-install server id from the client's uuid (never the uuid itself). */
export async function deriveClientDeviceId(secret: string, installId: string): Promise<string> {
  return `c_${await hmacHex(secret, `client|${installId}`)}`;
}

/** A brand-new random identity — 128 bits from the platform CSPRNG. */
export function freshDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `r_${hex(bytes, 16)}`;
}

export function requestNetworkKey(request: Request): { ip: string; ua: string } {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const ua = request.headers.get('user-agent') ?? 'unknown';
  return { ip, ua };
}

export async function resolveIdentity(
  request: Request,
  env: IdentityEnv,
  body: { signed_device_id?: unknown; deviceId?: unknown },
  opts: { legacyNetworkFallback?: boolean } = {},
): Promise<ResolvedIdentity> {
  const secret = identitySecret(env);
  const signed = typeof body.signed_device_id === 'string' ? body.signed_device_id.slice(0, 256) : '';
  const verified = signed ? await verifyDeviceId(signed, secret) : null;
  if (verified) return { deviceId: verified, issued: null, verified: true, source: 'signed' };

  const install = clientInstallId(body.deviceId);
  if (install) {
    const deviceId = await deriveClientDeviceId(secret, install);
    return { deviceId, issued: await signDeviceId(deviceId, secret), verified: false, source: 'client' };
  }
  if (opts.legacyNetworkFallback) {
    const { ip, ua } = requestNetworkKey(request);
    const deviceId = await deriveServerDeviceId(secret, ip, ua);
    return { deviceId, issued: await signDeviceId(deviceId, secret), verified: false, source: 'network' };
  }
  const deviceId = freshDeviceId();
  return { deviceId, issued: await signDeviceId(deviceId, secret), verified: false, source: 'fresh' };
}

/** Re-issue a signed id for a freshly minted identity (used when a resolved id must be abandoned). */
export async function mintFreshIdentity(env: IdentityEnv): Promise<ResolvedIdentity> {
  const deviceId = freshDeviceId();
  return { deviceId, issued: await signDeviceId(deviceId, identitySecret(env)), verified: false, source: 'fresh' };
}
