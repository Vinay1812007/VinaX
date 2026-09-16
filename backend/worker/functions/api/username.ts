/**
 * /api/username — unique-handle claim for the no-login identity model.
 *
 * Display names collide ("VINAY MAC" × 3 devices in User Management), so
 * onboarding now also claims a USERNAME: a unique, lowercase handle stored on
 * the device's vinax_users row. No accounts involved — the handle is bound to
 * the same device identity the telemetry pipeline uses (see _lib/identity.ts:
 * a signed device id when the client has one, otherwise an id derived from
 * the client's own install uuid, otherwise a fresh random id — never an id
 * shared by every client behind one network + browser build).
 *
 *   GET  /api/username?u=<handle>            → { available: boolean }
 *   POST /api/username { username, name?, signed_device_id?, deviceId?, current_username? }
 *        → 200 { ok, username, signed_device_id_next? }
 *        → 409 { error: "taken", suggestions: [...] }   (already exists)
 *        → 400 { error: "invalid" }                     (bad format)
 *        → 503 { error: "unavailable" }                 (store unreachable)
 *
 * Uniqueness is enforced case-insensitively: application-level check here
 * plus the partial unique index added in the vinax_users migration
 * (create unique index on lower(username)) as the race-proof backstop.
 */
import { sbSelect, sbSelectRes, sbUpsert, supabaseConfigured, type SupabaseEnv } from '../_lib/supabase';
import { mintFreshIdentity, resolveIdentity, type IdentityEnv, type ResolvedIdentity } from '../_lib/identity';
import { rateLimit } from '../_lib/ratelimit';

type Env = SupabaseEnv & IdentityEnv;

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
  const rows = await sbSelect<{ device_id: string }>(
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

/** The handle stored on a device row: null = no handle, undefined = read failed. */
async function handleOf(env: Env, deviceId: string): Promise<string | null | undefined> {
  const res = await sbSelectRes<{ username: string | null }>(
    env,
    'vinax_users',
    `device_id=eq.${encodeURIComponent(deviceId)}&select=username&limit=1`,
  );
  if (!res.ok) return undefined;
  return res.rows[0]?.username ?? null;
}

/**
 * Resolve who is claiming, then make sure the upsert can only touch a row
 * that belongs to THIS client. When the resolved row already carries a
 * handle the client does not recognise as its own, the identity is abandoned
 * for a fresh one — so a second listener behind the same network (or an
 * unrelated client that landed on a legacy shared id) can never overwrite
 * the first listener's username. Returns null when the store is unreachable.
 */
async function resolveClaimer(
  request: Request,
  env: Env,
  body: Record<string, unknown>,
): Promise<ResolvedIdentity | null> {
  const id = await resolveIdentity(request, env, body);
  const existing = await handleOf(env, id.deviceId);
  if (existing === undefined) return null;
  if (!existing) return id;
  const current = normalize(body.current_username);
  const claimed = normalize(body.username);
  // The row is this client's when it names the handle already stored there,
  // or is re-claiming that very handle.
  if (existing === current || existing === claimed) return id;
  // A device that PROVED its token and named no current handle (an older app
  // build, or one whose local copy was cleared) is renaming itself: the token
  // is its proof and it keeps its row. Anything else — an unverified client,
  // or a verified one whose stored handle disagrees with what it believes it
  // owns — is a different listener and gets its own identity.
  const currentProvided = typeof body.current_username === 'string' && body.current_username.trim() !== '';
  if (id.verified && !currentProvided) return id;
  return mintFreshIdentity(env);
}

/** Availability probe — used live while the listener types. */
export const onRequestGet = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  if (!supabaseConfigured(env)) return json({ available: true, unchecked: true });
  const limited = rateLimit(request, 'username-check', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const username = normalize(new URL(request.url).searchParams.get('u'));
  if (!username) return json({ available: false, error: 'invalid' }, 400);
  return json({ available: (await ownerOf(env, username)) === null });
};

/** Claim — called from onboarding's Continue and retried by the client until confirmed. Idempotent per device. */
export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  if (!supabaseConfigured(env)) return json({ ok: true, unchecked: true });
  const limited = rateLimit(request, 'username-claim', { capacity: 10, refillPerMinute: 5 }, env);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'invalid' }, 400);
  const username = normalize(body.username);
  if (!username) return json({ error: 'invalid' }, 400);

  const claimer = await resolveClaimer(request, env, body);
  if (!claimer) return json({ error: 'unavailable' }, 503);
  const { deviceId, issued, verified } = claimer;
  const owner = await ownerOf(env, username);
  // An existing handle may only be re-claimed by a device that PROVES it is
  // the owner via a valid signed id. A derived identity is not proof — two
  // browsers on one machine (e.g. incognito) can share it, which let the
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
  const saved = await sbUpsert(env, 'vinax_users', row, 'device_id');
  // The DB's unique index is the race backstop: if a parallel claim won,
  // the upsert fails and the handle reads as taken.
  if (!saved) return json({ error: 'taken', suggestions: await suggest(env, username) }, 409);

  const res: Record<string, unknown> = { ok: true, username };
  if (issued) res.signed_device_id_next = issued;
  return json(res);
};
