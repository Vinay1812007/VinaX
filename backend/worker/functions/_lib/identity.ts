/**
 * Who is this device? The one answer every listener-facing route uses.
 *
 * The app holds two things: a random install id it minted once (`deviceId`)
 * and, after its first contact, a server-signed id (`signed_device_id`). The
 * database only ever keys on the SERVER id:
 *
 *   1. A valid signed id → that id. The device has proved it is the same
 *      client (verified).
 *   2. Else an install id → `d_<hmac(secret, install id)>`. Nobody can join
 *      this row without knowing that exact uuid, and two browsers behind one
 *      network have different uuids, so they never merge.
 *   3. Else a fresh random id.
 *
 * An unverified client is handed a signed id to keep and echo next time
 * (`issued` → `signed_device_id_next` in the answer), so it is verified from
 * then on. Signed ids are `<id>.<base64url HMAC-SHA256>`.
 *
 * Secret: DEVICE_ID_SECRET (TELEMETRY_PEPPER as the fallback name).
 */

export interface IdentityEnv {
  DEVICE_ID_SECRET?: string;
  TELEMETRY_PEPPER?: string;
}

export type IdentitySource = 'signed' | 'install' | 'fresh';

export interface Identity {
  id: string;
  verified: boolean;
  source: IdentitySource;
  /** The signed id to hand back, or null when the client already proved itself. */
  issued: string | null;
}

/** The header the app sends on session checks and on sign-in. */
export const DEVICE_HEADER = 'x-vinax-device';

const INSTALL_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ID_RE = /^[a-z]_[a-f0-9]{16,64}$/;

export function identitySecret(env: IdentityEnv): string | null {
  return env.DEVICE_ID_SECRET?.trim() || env.TELEMETRY_PEPPER?.trim() || null;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hex(bytes: Uint8Array, n: number): string {
  let out = '';
  for (let i = 0; i < n; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(`device:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** `<id>.<signature>` the client stores and echoes. */
export async function signId(secret: string, id: string): Promise<string> {
  return `${id}.${b64url(await hmac(secret, id))}`;
}

/** The id inside a signed token when its signature is ours, else null. */
export async function verifySignedId(secret: string, token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length > 200) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  if (!ID_RE.test(id)) return null;
  const want = b64url(await hmac(secret, id));
  const got = token.slice(dot + 1);
  if (want.length !== got.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i += 1) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0 ? id : null;
}

/** A listener id derived from the app's install id: nobody can guess it without the uuid. */
export async function idFromInstall(secret: string, installId: string): Promise<string> {
  return `d_${hex(await hmac(secret, `install|${installId}`), 16)}`;
}

/** A brand-new random listener id. */
export function freshId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `r_${hex(bytes, 16)}`;
}

/**
 * Resolve the device behind a request body `{ deviceId?, signed_device_id? }`.
 * Null when the Worker has no signing secret (identity cannot be issued).
 */
export async function resolveIdentity(env: IdentityEnv, body: { deviceId?: unknown; signed_device_id?: unknown } | null, header?: string | null): Promise<Identity | null> {
  const secret = identitySecret(env);
  if (!secret) return null;
  const signed = await verifySignedId(secret, body?.signed_device_id ?? header ?? null);
  if (signed) return { id: signed, verified: true, source: 'signed', issued: null };
  const install = typeof body?.deviceId === 'string' && INSTALL_RE.test(body.deviceId) ? body.deviceId : null;
  if (install) {
    const id = await idFromInstall(secret, install);
    return { id, verified: false, source: 'install', issued: await signId(secret, id) };
  }
  return mintIdentity(env);
}

/** A fresh identity with its signed token (null without a secret). */
export async function mintIdentity(env: IdentityEnv): Promise<Identity | null> {
  const secret = identitySecret(env);
  if (!secret) return null;
  const id = freshId();
  return { id, verified: false, source: 'fresh', issued: await signId(secret, id) };
}

/** Only a signed, verified id — for routes where an unproven claim means nothing (session checks). */
export async function verifiedIdentity(env: IdentityEnv, token: unknown): Promise<string | null> {
  const secret = identitySecret(env);
  return secret ? verifySignedId(secret, token) : null;
}
