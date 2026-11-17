/**
 * 15.0 — what the social routes share: the session check, the shapes a
 * profile and a shared playlist may hold (every field clipped and checked
 * here, never trusted from the body), and short url-safe ids.
 *
 * Tables: profiles, follows, shared_playlists
 * (backend/supabase/schema.sql § 2). Only the Worker reads or writes them.
 */
import { bearer, readSession, type AuthEnv } from './googleAuth';
import { json } from './authShared';
import { db, dbConfigured, like, q, since, type DbEnv } from './db';
import { asObject, clip } from './edge';

export type SocialEnv = AuthEnv & DbEnv;

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
export const MAX_SUMMARY_BYTES = 24_000;
export const MAX_PLAYLIST_SONGS = 500;
export const MAX_PLAYLIST_BYTES = 600_000;

/** A session or the 401; a database or the 503. */
export async function requireAccount(env: SocialEnv, request: Request): Promise<{ sub: string } | { fail: Response }> {
  const sub = await readSession(env, bearer(request));
  if (!sub) return { fail: json({ error: 'signed_out' }, 401) };
  if (!dbConfigured(env)) return { fail: json({ error: 'unavailable' }, 503) };
  return { sub };
}

export const normalizeHandle = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const u = raw.trim().toLowerCase();
  return HANDLE_RE.test(u) ? u : null;
};

/** 12 url-safe chars from the platform CSPRNG. */
export function newId(len = 12): string {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < len; i += 1) s += a[buf[i] % a.length];
  return s;
}

export function newToken(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A song as the social tables keep it: display fields only, ≤ 4 KB. */
export function cleanSong(raw: unknown): Record<string, unknown> | null {
  const s = asObject(raw);
  if (!s) return null;
  const out: Record<string, unknown> = {};
  // `by` (1.12): who added it to a shared playlist, kept across the owner's writes.
  for (const k of ['id', 'title', 'subtitle', 'image', 'language', 'year', 'by']) {
    const v = s[k];
    if (typeof v === 'string') out[k] = v.slice(0, k === 'image' ? 512 : k === 'by' ? 40 : 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  if (typeof s.duration === 'number' && Number.isFinite(s.duration)) out.duration = s.duration;
  for (const k of ['artists', 'images']) if (Array.isArray(s[k])) out[k] = (s[k] as unknown[]).slice(0, 6);
  if (!out.id || typeof out.id !== 'string') return null;
  return JSON.stringify(out).length <= 4096 ? out : { id: out.id, title: out.title ?? null, subtitle: out.subtitle ?? null, image: out.image ?? null };
}

export interface ProfileSummary {
  topArtists: Array<{ name: string; plays: number }>;
  topLanguages: Array<{ id: string; pct: number }>;
  recentLikes: Array<Record<string, unknown>>;
  /** 1.12 — badges a device had earned. 2.0 removed them: never stored, always answered empty. */
  badges?: string[];
}


/** The digest the device sends: a few top artists and languages, up to 20 recent likes. */
export function cleanSummary(raw: unknown): ProfileSummary {
  const s = asObject(raw) ?? {};
  const topArtists = (Array.isArray(s.topArtists) ? s.topArtists : [])
    .slice(0, 10)
    .map((a) => {
      const o = asObject(a);
      const name = clip(o?.name, 80);
      const plays = typeof o?.plays === 'number' && Number.isFinite(o.plays) ? Math.max(0, Math.round(o.plays)) : 0;
      return name ? { name, plays } : null;
    })
    .filter((a): a is { name: string; plays: number } => !!a);
  const topLanguages = (Array.isArray(s.topLanguages) ? s.topLanguages : [])
    .slice(0, 6)
    .map((l) => {
      const o = asObject(l);
      const id = clip(o?.id, 24);
      const pct = typeof o?.pct === 'number' && Number.isFinite(o.pct) ? Math.max(0, Math.min(100, Math.round(o.pct))) : 0;
      return id ? { id, pct } : null;
    })
    .filter((l): l is { id: string; pct: number } => !!l);
  const recentLikes = (Array.isArray(s.recentLikes) ? s.recentLikes : []).slice(0, 20).map(cleanSong).filter((x): x is Record<string, unknown> => !!x);
  // 2.0 — badges are gone: a list an older app sends is dropped.
  return { topArtists, topLanguages, recentLikes };
}

export interface ProfileRow {
  account_id: string;
  handle: string;
  public: boolean;
  bio: string | null;
  summary: ProfileSummary;
  now_playing: Record<string, unknown> | null;
  share_now: boolean;
  /** v23 — "Let people I follow join my room" (absent on a database before v23). */
  share_jam?: boolean;
  /** v23 — the code of the room this listener hosts, while they share it (rooms.code; set null when the room goes). */
  jam_code?: string | null;
  updated_at: string;
}

/** What anyone may see of a profile (the account id never leaves). */
export function publicProfile(p: ProfileRow, extra: { following?: boolean; followers?: number; name?: string | null; picture?: string | null; own?: boolean; jamCode?: string | null } = {}) {
  // Now playing is shared only while fresh (the device writes it with sync).
  const fresh = p.share_now && p.now_playing && Date.now() - Date.parse(p.updated_at) < 20 * 60_000;
  return {
    handle: p.handle,
    name: extra.name ?? null,
    picture: extra.picture ?? null,
    bio: p.bio,
    public: p.public,
    topArtists: p.summary?.topArtists ?? [],
    topLanguages: p.summary?.topLanguages ?? [],
    recentLikes: p.summary?.recentLikes ?? [],
    // 2.0 — badges are gone; older apps still read the field, so it stays, empty.
    badges: [],
    nowPlaying: fresh ? p.now_playing : null,
    updatedAt: p.updated_at,
    ...(extra.following !== undefined ? { following: extra.following } : {}),
    ...(extra.followers !== undefined ? { followers: extra.followers } : {}),
    // v23 — the room to join: only what jamFor allowed (a mutual follower, a live room).
    ...(extra.jamCode ? { jamCode: extra.jamCode } : {}),
    // The owner also sees their own sharing switches; nobody else does.
    ...(extra.own ? { shareNow: p.share_now, shareJam: p.share_jam === true } : {}),
  };
}

/**
 * v23 — join a friend's jam. A room counts as live while its host has pushed
 * in the last few minutes: a host's app pushes every 4 s while it runs, and a
 * locked phone that throttles that for a while is still the same room.
 */
export const JAM_LIVE_MS = 3 * 60_000;
export const ROOM_CODE_RE = /^[A-Z0-9]{4,8}$/;

/**
 * The codes among `codes` whose room is live right now. A database failure
 * answers none: a code is never shown without this check.
 */
export async function liveRoomCodes(env: DbEnv, codes: Array<string | null | undefined>, now = Date.now()): Promise<Set<string>> {
  const want = [...new Set(codes.filter((c): c is string => typeof c === 'string' && ROOM_CODE_RE.test(c)))];
  if (!want.length) return new Set();
  const r = await db.select<{ code: string }>(env, 'rooms', q().in('code', want).gte('updated_at', since(JAM_LIVE_MS, now)).select('code').limit(want.length));
  return new Set(r.ok ? r.rows.map((x) => x.code) : []);
}

/**
 * The join code a viewer may see on a profile, or null. The room code is the
 * join credential, so it goes only to a MUTUAL follower (the viewer follows
 * the owner and the owner follows the viewer back), only while the owner's
 * switch is on, and only while the room is live.
 */
export function jamFor(p: ProfileRow, mutual: boolean, live: Set<string>): string | null {
  if (!mutual || p.share_jam !== true || !p.jam_code) return null;
  return live.has(p.jam_code) ? p.jam_code : null;
}

export async function profileByHandle(env: DbEnv, handle: string) {
  return db.one<ProfileRow>(env, 'profiles', q().ilike('handle', like(handle)));
}

export async function profileOf(env: DbEnv, sub: string) {
  return db.one<ProfileRow>(env, 'profiles', q().eq('account_id', sub));
}

export async function isFollowing(env: DbEnv, follower: string, followee: string): Promise<boolean | null> {
  const r = await db.one<{ follower_id: string }>(env, 'follows', q().eq('follower_id', follower).eq('followee_id', followee).select('follower_id'));
  return r.ok ? !!r.value : null;
}
