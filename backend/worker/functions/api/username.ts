/**
 * /api/username — unique-handle claim for the no-login identity model.
 *
 * Display names collide ("VINAY MAC" × 3 devices in User Management), so
 * onboarding now also claims a USERNAME: a unique, lowercase handle stored on
 * the device's vinax_users row. No accounts involved — the handle is bound to
 * the same device identity the telemetry pipeline uses (signed device id when
 * the client has one, ip+ua-derived otherwise, exactly like /api/events).
 *
 *   GET  /api/username?u=<handle>            → { available: boolean }
 *   POST /api/username { username, name?, signed_device_id? }
 *        → 200 { ok, username, signed_device_id_next? }
 *        → 409 { error: "taken", suggestions: [...] }   (already exists)
 *        → 400 { error: "invalid" }                     (bad format)
 *
 * Uniqueness is enforced case-insensitively: application-level check here
 * plus the partial unique index added in the vinax_users migration
 * (create unique index on lower(username)) as the race-proof backstop.
 */
import { dbSelect, dbUpsert, dbConfigured, type DbEnv } from '../_lib/db';
import { deriveServerDeviceId, signDeviceId, verifyDeviceId } from '../_lib/deviceid';
import { rateLimit } from '../_lib/ratelimit';

interface Env extends DbEnv {
  DEVICE_ID_SECRET?: string;
  TELEMETRY_PEPPER?: string;
}

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const normalize = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const u = raw.trim().toLowerCase();
  return HANDLE_RE.test(u) ? u : null;
};

/** Owner device of a handle, or null when the handle is free. */
async function ownerOf(env: Env, username: string): Promise<string | null> {
  const rows = await dbSelect<{ device_id: string }>(
    env,
    'vinax_users',
    `username=ilike.${encodeURIComponent(username)}&select=device_id&limit=1`,
  );
  return rows[0]?.device_id ?? null;
}

/** vinay → vinay_2814-style alternatives that are actually free right now. */
async function suggest(env: Env, base: string): Promise<string[]> {
  const stem = base.slice(0, 15);
  const out: string[] = [];
  for (let i = 0; i < 6 && out.length < 3; i += 1) {
    const cand = `${stem}_${Math.floor(1000 + Math.random() * 9000)}`;
    if ((await ownerOf(env, cand)) === null) out.push(cand);
  }
  return out;
}

/** Same identity resolution as /api/events: signed id wins, ip+ua fallback. */
async function resolveDevice(
  request: Request,
  env: Env,
  claimedSigned: unknown,
): Promise<{ deviceId: string; issued: string | null; verified: boolean }> {
  const secret = env.DEVICE_ID_SECRET ?? env.TELEMETRY_PEPPER ?? 'vinax-default-pepper-set-me';
  const signed = typeof claimedSigned === 'string' ? claimedSigned.slice(0, 256) : '';
  const verified = signed ? await verifyDeviceId(signed, secret) : null;
  if (verified) return { deviceId: verified, issued: null, verified: true };
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const ua = request.headers.get('user-agent') ?? 'unknown';
  const deviceId = await deriveServerDeviceId(secret, ip, ua);
  return { deviceId, issued: await signDeviceId(deviceId, secret), verified: false };
}

/** Availability probe — used live while the listener types. */
export const onRequestGet = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  if (!dbConfigured(env)) return json({ available: true, unchecked: true });
  const limited = await rateLimit(request, 'username-check', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const username = normalize(new URL(request.url).searchParams.get('u'));
  if (!username) return json({ available: false, error: 'invalid' }, 400);
  return json({ available: (await ownerOf(env, username)) === null });
};

/** Claim — called once from onboarding's Continue. Idempotent per device. */
export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  if (!dbConfigured(env)) return json({ ok: true, unchecked: true });
  const limited = await rateLimit(request, 'username-claim', { capacity: 10, refillPerMinute: 5, global: true }, env);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'invalid' }, 400);
  const username = normalize(body.username);
  if (!username) return json({ error: 'invalid' }, 400);

  const { deviceId, issued, verified } = await resolveDevice(request, env, body.signed_device_id);
  const owner = await ownerOf(env, username);
  // An existing handle may only be re-claimed by a device that PROVES it is
  // the owner via a valid signed id. Ip+ua-derived identity is not proof —
  // two browsers on one machine (e.g. incognito) share it, which let the
  // same handle be "created" twice. Unverified claimers always get 409.
  if (owner && !(verified && owner === deviceId)) {
    return json({ error: 'taken', suggestions: await suggest(env, username) }, 409);
  }

  const row: Record<string, unknown> = {
    device_id: deviceId,
    username,
    last_seen: new Date().toISOString(),
  };
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (name) row.name = name;
  const saved = await dbUpsert(env, 'vinax_users', row, 'device_id');
  // The DB's unique index is the race backstop: if a parallel claim won,
  // the upsert fails and the handle reads as taken.
  if (!saved) return json({ error: 'taken', suggestions: await suggest(env, username) }, 409);

  const res: Record<string, unknown> = { ok: true, username };
  if (issued) res.signed_device_id_next = issued;
  return json(res);
};
