/**
 * Package C1 — the handoff relay: a dead-drop for encrypted profile blobs.
 *
 * POST { blob, iv }  → { id }        stores the ciphertext in KV, TTL 10 min
 * GET  ?c=<id>       → { blob, iv }  one-time read: the blob is DELETED the
 *                                    moment it is fetched, so a link can never
 *                                    be replayed even inside the TTL window
 *
 * Privacy: the blob arrives AES-GCM-encrypted with a key derived from a
 * passphrase that never reaches this function (it travels in the QR's URL
 * fragment or the listener's head). We store ciphertext we cannot read, for
 * minutes, then it's gone. No IPs, no ids, no logging.
 *
 * Binding: create a KV namespace and bind it as HANDOFF in the Cloudflare
 * Pages project (Settings → Functions → KV namespace bindings). Until then
 * this route answers 503 { error: 'not_configured' } and the client shows
 * the file-based export/import path instead.
 */
import { rateLimit } from '../_lib/ratelimit';

/** Structural slice of a Cloudflare KV namespace — keeps us type-safe without
 *  pulling in worker types the rest of the functions don't use. */
interface HandoffKV {
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

interface Env {
  HANDOFF?: HandoffKV;
  TELEMETRY_PEPPER?: string;
}

const TTL_SECONDS = 600; // ten minutes, enforced by KV itself
// Export JSON caps at 5 MB client-side; base64 + AES overhead lands well
// under 8 MB. Anything bigger is not a VinaX profile.
const MAX_BLOB_B64 = 8 * 1024 * 1024;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    // ACAO on the ACTUAL responses, not just the preflight: the Android app
    // calls this endpoint cross-origin (Capacitor shell → absolute origin),
    // and without this header the browser passed preflight then BLOCKED the
    // real response — "Move to a new device" simply never worked in the app.
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });

function randomId(): string {
  // 10 chars from a 32-char alphabet = 50 bits — unguessable within a 10-min
  // TTL at any polite request rate, and short enough for a QR + manual entry.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  if (!env.HANDOFF) return json({ error: 'not_configured' }, 503);
  const limited = await rateLimit(request, 'handoff-put', { capacity: 5, refillPerMinute: 3, global: true }, env);
  if (limited) return limited;

  let body: { blob?: unknown; iv?: unknown };
  try {
    body = (await request.json()) as { blob?: unknown; iv?: unknown };
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const blob = typeof body.blob === 'string' ? body.blob : '';
  const iv = typeof body.iv === 'string' ? body.iv : '';
  if (!blob || !iv || blob.length > MAX_BLOB_B64 || iv.length > 64) return json({ error: 'bad_request' }, 400);
  // Both fields must be base64 — this relay only ever holds ciphertext.
  if (!/^[A-Za-z0-9+/=]+$/.test(blob) || !/^[A-Za-z0-9+/=]+$/.test(iv)) return json({ error: 'bad_request' }, 400);

  const id = randomId();
  await env.HANDOFF.put(`h:${id}`, JSON.stringify({ blob, iv }), { expirationTtl: TTL_SECONDS });
  return json({ id, ttl: TTL_SECONDS });
};

export const onRequestGet = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  if (!env.HANDOFF) return json({ error: 'not_configured' }, 503);
  const limited = await rateLimit(request, 'handoff-get', { capacity: 10, refillPerMinute: 5 }, env);
  if (limited) return limited;

  const id = new URL(request.url).searchParams.get('c') ?? '';
  if (!/^[a-z2-9]{10}$/.test(id)) return json({ error: 'bad_request' }, 400);
  const key = `h:${id}`;
  const stored = await env.HANDOFF.get(key);
  if (!stored) return json({ error: 'gone' }, 404);
  // Burn on read BEFORE returning — a handoff link works exactly once.
  await env.HANDOFF.delete(key);
  return new Response(stored, {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
};

// Repo convention (dj.ts): method-specific exports only. GET and POST are both
// real here; OPTIONS gets the standard preflight answer.
export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
