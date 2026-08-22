/**
 * Signed device-id scheme for telemetry ingest (audit finding H-SRV-6).
 *
 * The old /api/events accepted any client-supplied deviceId and used it as a
 * primary key across vinax_users and vinax_events. An attacker could impersonate
 * or spoof any device just by echoing its id, poisoning per-listener metrics
 * and joining events across identities.
 *
 * signDeviceId + verifyDeviceId use HMAC-SHA256 over the id with the server
 * DEVICE_ID_SECRET. Format: `<id>.<base64url-sig>`. verifyDeviceId returns the
 * original id if the signature is valid, else null.
 *
 * On unsigned first-contact, api/events.ts derives a stable server-side id
 * from HMAC(secret, ip|user-agent) so downstream metrics remain per-device
 * without ever trusting the client's claim.
 */

function b64urlBytes(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array | null {
  try {
    const pad = s.length % 4;
    const norm = s.replace(/-/g, '+').replace(/_/g, '/') + (pad ? '='.repeat(4 - pad) : '');
    const bin = atob(norm);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
    return buf;
  } catch {
    return null;
  }
}

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return new Uint8Array(sig);
}

/** Sign an id: returns `<id>.<base64url-sig>` — the whole string is what the
 *  client stores and echoes back on subsequent /api/events posts. */
export async function signDeviceId(id: string, secret: string): Promise<string> {
  const sig = await hmac(secret, id);
  return `${id}.${b64urlBytes(sig)}`;
}

/** Verify a signed device id. Returns the raw id on success, null on any
 *  parse / signature failure. Constant-time compare inside the digest space. */
export async function verifyDeviceId(signed: string, secret: string): Promise<string | null> {
  if (typeof signed !== 'string') return null;
  const dot = signed.lastIndexOf('.');
  if (dot <= 0 || dot === signed.length - 1) return null;
  const id = signed.slice(0, dot);
  const claimed = b64urlDecode(signed.slice(dot + 1));
  if (!claimed) return null;
  const expected = await hmac(secret, id);
  if (claimed.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= claimed[i] ^ expected[i];
  return diff === 0 ? id : null;
}

/** Derive a stable server-side device id from IP + UA when the client sends
 *  no signed id. Not perfect (multiple listeners behind one NAT collide) but
 *  strictly better than trusting the client's claim — no cross-device joins
 *  possible without also knowing the pepper. */
export async function deriveServerDeviceId(secret: string, ip: string, ua: string): Promise<string> {
  const sig = await hmac(secret, `${ip}|${ua}`);
  // Use 16 bytes = 128 bits of the digest as the device id.
  let hex = '';
  for (let i = 0; i < 16; i += 1) hex += sig[i].toString(16).padStart(2, '0');
  return `s_${hex}`;
}
