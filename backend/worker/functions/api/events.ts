/**
 * POST /api/events — anonymous usage events the app sends after the listener
 * opted in to usage sharing (Settings → Your data).
 *
 *   headers  x-vinax-consent: analytics      (required — no consent, nothing is kept)
 *   body     { deviceId?, signed_device_id?, name?, type, platform?, appVersion?,
 *              song?: { id, title, artist, language, image }, errorKind?, message?, meta? }
 *   → 204                                    stored (or dropped — the answer never tells)
 *   → 200 { signed_device_id_next }          first contact: the signed id the app keeps
 *
 * What is written: one `events` row (the event itself, song facts, coarse edge
 * geo) and the device's latest-state `listeners` row. Device identity comes
 * from _lib/identity.ts — never the raw client id. The database work runs
 * after the answer (waitUntil), so a slow database never delays the app.
 */
import { db, dbConfigured, type DbEnv } from '../_lib/db';
import { appVersionOf, asObject, clip, edgeGeo, platformOf, songFacts } from '../_lib/edge';
import { resolveIdentity, type IdentityEnv } from '../_lib/identity';
import { rateLimitAsync } from '../_lib/ratelimit';

type Env = DbEnv & IdentityEnv;

interface Ctx {
  request: Request;
  env?: Env;
  waitUntil?: (p: Promise<unknown>) => void;
}

/**
 * Every request header the app's telemetry client sends
 * (frontend/src/services/analytics/telemetry.ts). A header missing here makes
 * the browser refuse every cross-origin post at the preflight.
 */
export const EVENTS_REQUEST_HEADERS = ['content-type', 'x-vinax-consent', 'x-vinax-client'] as const;

/**
 * Origins allowed to post consented events cross-origin: the site itself and
 * the app shells (Capacitor serves bundled assets from https://localhost on
 * Android and capacitor://localhost on iOS), plus loopback for local
 * development. A wildcard would let any third-party page make its visitors'
 * browsers post "consented" events.
 */
const APP_ORIGINS: ReadonlySet<string> = new Set([
  'https://www.vinaxmusic.online',
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
]);
const LOOPBACK_DEV = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function eventsCors(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': EVENTS_REQUEST_HEADERS.join(', '),
    'access-control-max-age': '86400',
    vary: 'origin',
  };
  if (origin && (APP_ORIGINS.has(origin) || LOOPBACK_DEV.test(origin))) headers['access-control-allow-origin'] = origin;
  return headers;
}

/** Event kinds the app may send. Anything else is dropped silently. */
const KIND_RE = /^[a-z][a-z0-9_-]{1,39}$/;
/** Kinds reserved for the server's own markers: a client can never write one. */
const RESERVED_KINDS: ReadonlySet<string> = new Set(['announcement', 'push', 'push-receipt', 'job', 'audit', 'system']);
export function isReservedKind(kind: string): boolean {
  const k = kind.toLowerCase();
  return k.startsWith('admin') || RESERVED_KINDS.has(k);
}

/** Kinds that may carry structured `meta` (recommendation telemetry). */
const META_KINDS: ReadonlySet<string> = new Set(['rec_served', 'rec_outcome']);
const META_MAX_BYTES = 1024;
const META_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

/**
 * A flat record of short strings, finite numbers, booleans, nulls, string
 * lists and string maps — at most 1 KB serialised. Anything else is dropped,
 * never truncated mid-value.
 */
export function sanitizeMeta(kind: string, raw: unknown): Record<string, unknown> | null {
  if (!META_KINDS.has(kind)) return null;
  const o = asObject(raw);
  if (!o) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (!META_KEY_RE.test(k)) continue;
    if (v === null || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v.slice(0, 40).map((x) => x.slice(0, 120));
    else if (asObject(v) && Object.values(v as object).every((x) => typeof x === 'string')) {
      const m: Record<string, string> = {};
      for (const [mk, mv] of Object.entries(v as Record<string, string>).slice(0, 40)) if (META_KEY_RE.test(mk)) m[mk] = mv.slice(0, 120);
      out[k] = m;
    }
    if (Object.keys(out).length >= 40) break;
  }
  if (!Object.keys(out).length) return null;
  // Measured in bytes, as the database does (events_meta_shape checks
  // octet_length): a meta full of multi-byte text must not pass here and then
  // be refused by the insert.
  return new TextEncoder().encode(JSON.stringify(out)).length <= META_MAX_BYTES ? out : null;
}

export const onRequestOptions = async (context: { request: Request }): Promise<Response> =>
  new Response(null, { status: 204, headers: eventsCors(context.request.headers.get('origin')) });

export const onRequestPost = async (context: Ctx): Promise<Response> => {
  const { request } = context;
  const env = context.env ?? {};
  const cors = eventsCors(request.headers.get('origin'));
  const ok = new Response(null, { status: 204, headers: cors });
  const limited = await rateLimitAsync(request, 'events', { capacity: 60, refillPerMinute: 60 }, env);
  if (limited) return limited;
  if (request.headers.get('x-vinax-consent') !== 'analytics') return ok;
  if (!dbConfigured(env)) return ok;

  const body = asObject(await request.json().catch(() => null));
  if (!body) return ok;
  const kind = clip(body.type, 40)?.toLowerCase() ?? '';
  if (!KIND_RE.test(kind) || isReservedKind(kind)) return ok;

  const identity = await resolveIdentity(env, body);
  if (!identity) return ok; // no signing secret on this Worker: identity cannot be issued, nothing is kept

  const geo = edgeGeo(request);
  const song = songFacts(body.song);
  const platform = platformOf(body.platform, request);
  const appVersion = appVersionOf(body.appVersion, request);
  const now = new Date().toISOString();

  const eventRow: Record<string, unknown> = {
    at: now,
    listener_id: identity.id,
    kind,
    song_id: song?.id ?? null,
    song_title: song?.title ?? null,
    song_artist: song?.artist ?? null,
    song_image: song?.image ?? null,
    language: song?.language ?? null,
    platform,
    app_version: appVersion,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    error_kind: kind === 'error' ? clip(body.errorKind, 40) : null,
    message: clip(body.message, 300),
    verified: identity.verified,
  };
  const meta = sanitizeMeta(kind, body.meta);
  if (meta) eventRow.meta = meta;

  const listenerRow: Record<string, unknown> = {
    id: identity.id,
    platform,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    last_seen: now,
  };
  const name = clip(body.name, 80);
  if (name) listenerRow.display_name = name;
  if (appVersion) listenerRow.app_version = appVersion;
  if (kind === 'play' || kind === 'heartbeat') listenerRow.is_playing = true;
  else if (kind === 'pause' || kind === 'complete') listenerRow.is_playing = false;
  if (song?.title) listenerRow.now_playing = { id: song.id, title: song.title, artist: song.artist, image: song.image, language: song.language };

  const write = (async () => {
    const [ev, li] = await Promise.all([db.insert(env, 'events', eventRow), db.upsert(env, 'listeners', listenerRow, 'id')]);
    if (!ev.ok) console.warn(`[events] event not stored (${ev.error}${ev.status ? ` ${ev.status}` : ''}${ev.code ? ` ${ev.code}` : ''})`);
    if (!li.ok) console.warn(`[events] listener not stored (${li.error}${li.status ? ` ${li.status}` : ''}${li.code ? ` ${li.code}` : ''})`);
  })().catch(() => undefined);
  if (context.waitUntil) context.waitUntil(write);
  else await write;

  if (identity.issued) {
    return new Response(JSON.stringify({ signed_device_id_next: identity.issued }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors },
    });
  }
  return ok;
};
