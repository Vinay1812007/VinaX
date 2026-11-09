/**
 * 1.12 — public song reactions: one per device per song, from a fixed set
 * (fire, love, sad, dance, wow). Counts are public; who reacted never leaves
 * the Worker (the id kept is the derived listener id, as for /api/events).
 *
 *   GET  /api/reactions?song=<id>[&deviceId=&signed_device_id=]
 *        → { total, counts: { fire: n, … }, mine: 'fire' | null }
 *   POST /api/reactions { song, emoji | null, deviceId?, signed_device_id?, title?, artist?, image?, language? }
 *        → the same, after the change (null, or the same emoji again, takes the reaction away)
 *        [+ signed_device_id_next on first contact, as /api/events hands it out]
 *        400 song_required | bad_emoji | device_required · 429 rate_limited · 503 not_configured
 */
import { db, dbConfigured, type DbEnv } from '../_lib/db';
import { asObject, clip, jsonResponse } from '../_lib/edge';
import { resolveIdentity, type IdentityEnv } from '../_lib/identity';
import { methodNotAllowed, rateLimitAsync } from '../_lib/ratelimit';

type Env = DbEnv & IdentityEnv;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export const EMOJI = ['fire', 'love', 'sad', 'dance', 'wow'] as const;
export type Emoji = (typeof EMOJI)[number];
const isEmoji = (v: unknown): v is Emoji => typeof v === 'string' && (EMOJI as readonly string[]).includes(v);
const SONG_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface Counts { total: number; counts: Partial<Record<Emoji, number>>; mine: Emoji | null }

const empty = (): Counts => ({ total: 0, counts: {}, mine: null });

async function counts(env: Env, song: string, listener: string | null): Promise<Counts> {
  const r = await db.rpc<Record<string, unknown>>(env, 'song_reaction_counts', { p_song: song, p_listener: listener });
  if (!r.ok || !r.value) return empty();
  const v = r.value;
  const out: Counts = empty();
  out.total = typeof v.total === 'number' ? v.total : Number(v.total) || 0;
  if (v.counts && typeof v.counts === 'object') for (const [k, n] of Object.entries(v.counts as Record<string, unknown>)) if (isEmoji(k)) out.counts[k] = Number(n) || 0;
  out.mine = isEmoji(v.mine) ? v.mine : null;
  return out;
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  if (!dbConfigured(env)) return jsonResponse({ error: 'not_configured' }, 503, CORS);
  const url = new URL(request.url);
  const song = clip(url.searchParams.get('song'), 64);
  if (!song || !SONG_RE.test(song)) return jsonResponse({ error: 'song_required' }, 400, CORS);
  // Only a device that names itself gets "mine"; a bare read is anonymous (no fresh id is minted for it).
  const named = { deviceId: url.searchParams.get('deviceId') ?? undefined, signed_device_id: url.searchParams.get('signed_device_id') ?? undefined };
  const identity = named.deviceId || named.signed_device_id ? await resolveIdentity(env, named) : null;
  return jsonResponse(await counts(env, song, identity?.id ?? null), 200, { ...CORS, 'cache-control': 'no-store' });
};

export const onRequestPut = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const limited = await rateLimitAsync(request, 'reactions', { capacity: 20, refillPerMinute: 10 }, env);
  if (limited) return limited;
  if (!dbConfigured(env)) return jsonResponse({ error: 'not_configured' }, 503, CORS);
  const body = asObject(await request.json().catch(() => null)) ?? {};
  const song = clip(body.song, 64);
  if (!song || !SONG_RE.test(song)) return jsonResponse({ error: 'song_required' }, 400, CORS);
  if (body.emoji !== null && body.emoji !== undefined && !isEmoji(body.emoji)) return jsonResponse({ error: 'bad_emoji', emoji: EMOJI }, 400, CORS);
  // The device must name itself (install id or signed id), or every tap would be a new anonymous device.
  if (typeof body.deviceId !== 'string' && typeof body.signed_device_id !== 'string') return jsonResponse({ error: 'device_required' }, 400, CORS);
  const identity = await resolveIdentity(env, body);
  // No signing secret on this Worker: nothing can be attributed, so nothing is kept.
  if (!identity) return jsonResponse({ error: 'not_configured' }, 503, CORS);
  const before = await counts(env, song, identity.id);
  const wanted = isEmoji(body.emoji) && body.emoji !== before.mine ? body.emoji : null;
  if (wanted) {
    const r = await db.upsert(env, 'song_reactions', {
      song_id: song, listener_id: identity.id, emoji: wanted, at: new Date().toISOString(),
      song_title: clip(body.title, 200), song_artist: clip(body.artist, 200), song_image: clip(body.image, 512), language: clip(body.language, 24)?.toLowerCase() ?? null,
    }, 'song_id,listener_id');
    if (!r.ok) return jsonResponse({ error: 'unavailable' }, 503, CORS);
  } else if (before.mine) {
    const r = await db.remove(env, 'song_reactions', `song_id=eq.${encodeURIComponent(song)}&listener_id=eq.${encodeURIComponent(identity.id)}`);
    if (!r.ok) return jsonResponse({ error: 'unavailable' }, 503, CORS);
  }
  const after = await counts(env, song, identity.id);
  return jsonResponse({ ...after, ...(identity.issued ? { signed_device_id_next: identity.issued } : {}) }, 200, { ...CORS, 'cache-control': 'no-store' });
};
