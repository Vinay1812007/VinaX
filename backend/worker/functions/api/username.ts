/**
 * /api/username — the unique VinaX handle (older app builds claim one at
 * onboarding; since 13.0 most listeners are named by their Google account).
 *
 *   GET  /api/username?u=<handle>  → { available }            (400 { available: false, error: 'invalid' })
 *   POST /api/username { username, name?, deviceId?, signed_device_id?, current_username? }
 *        → 200 { ok: true, username, signed_device_id_next? }
 *        → 400 { error: 'invalid' }
 *        → 409 { error: 'taken', suggestions: [...] }
 *        → 503 { error: 'unavailable' }
 *
 * The handle lives on the caller's `listeners` row (`handle`, unique
 * case-insensitively — the index is the race backstop). A device may rename
 * itself or re-claim its own handle; a handle another device holds is taken.
 * Without a database the answers say `unchecked`, as installed builds expect.
 */
import { db, dbConfigured, like, q, type DbEnv } from '../_lib/db';
import { asObject, clip, jsonResponse } from '../_lib/edge';
import { resolveIdentity, type IdentityEnv } from '../_lib/identity';
import { rateLimit } from '../_lib/ratelimit';

type Env = DbEnv & IdentityEnv;

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (body: unknown, status = 200): Response => jsonResponse(body, status, CORS);

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const normalizeHandle = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const u = raw.trim().toLowerCase();
  return HANDLE_RE.test(u) ? u : null;
};

/** The device holding a handle, null when free, undefined when the read failed. */
async function ownerOf(env: Env, handle: string): Promise<string | null | undefined> {
  const r = await db.one<{ id: string }>(env, 'listeners', q().ilike('handle', like(handle)).select('id'));
  if (!r.ok) return undefined;
  return r.value?.id ?? null;
}

/** `name_2814`-style alternatives that are free right now. */
async function suggest(env: Env, base: string): Promise<string[]> {
  const stem = base.slice(0, 15);
  const out: string[] = [];
  for (let i = 0; i < 6 && out.length < 3; i += 1) {
    const cand = `${stem}_${Math.floor(1000 + Math.random() * 9000)}`;
    if ((await ownerOf(env, cand)) === null) out.push(cand);
  }
  return out;
}

export const onRequestGet = async (ctx?: { request: Request; env: Env }): Promise<Response> => {
  if (!ctx || !dbConfigured(ctx.env)) return json({ available: true, unchecked: true });
  const limited = rateLimit(ctx.request, 'username-check', { capacity: 30, refillPerMinute: 30 }, ctx.env);
  if (limited) return limited;
  const handle = normalizeHandle(new URL(ctx.request.url).searchParams.get('u'));
  if (!handle) return json({ available: false, error: 'invalid' }, 400);
  const owner = await ownerOf(ctx.env, handle);
  if (owner === undefined) return json({ error: 'unavailable' }, 503);
  return json({ available: owner === null });
};

export const onRequestPost = async (ctx?: { request: Request; env: Env }): Promise<Response> => {
  if (!ctx || !dbConfigured(ctx.env)) return json({ ok: true, unchecked: true });
  const { request, env } = ctx;
  const limited = rateLimit(request, 'username-claim', { capacity: 10, refillPerMinute: 5 }, env);
  if (limited) return limited;
  const body = asObject(await request.json().catch(() => null));
  const handle = normalizeHandle(body?.username);
  if (!body || !handle) return json({ error: 'invalid' }, 400);

  const identity = await resolveIdentity(env, body);
  if (!identity) return json({ error: 'unavailable' }, 503);
  const owner = await ownerOf(env, handle);
  if (owner === undefined) return json({ error: 'unavailable' }, 503);
  // Another device holds it. An UNVERIFIED claimer never re-claims a held
  // handle, even one its derived id matches: two browsers on one machine
  // can share a derived id, a signed token they cannot.
  if (owner && !(identity.verified && owner === identity.id)) return json({ error: 'taken', suggestions: await suggest(env, handle) }, 409);

  const row: Record<string, unknown> = { id: identity.id, handle, last_seen: new Date().toISOString() };
  const name = clip(body.name, 80);
  if (name) row.display_name = name;
  const saved = await db.upsert(env, 'listeners', row, 'id');
  if (!saved.ok) {
    // The unique index refused it: a parallel claim won.
    if (saved.error === 'conflict') return json({ error: 'taken', suggestions: await suggest(env, handle) }, 409);
    return json({ error: 'unavailable' }, 503);
  }
  const out: Record<string, unknown> = { ok: true, username: handle };
  if (identity.issued) out.signed_device_id_next = identity.issued;
  return json(out);
};
