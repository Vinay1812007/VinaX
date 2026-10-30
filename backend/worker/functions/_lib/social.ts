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
import { db, dbConfigured, like, q, type DbEnv } from './db';
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
  for (const k of ['id', 'title', 'subtitle', 'image', 'language', 'year']) {
    const v = s[k];
    if (typeof v === 'string') out[k] = v.slice(0, k === 'image' ? 512 : 200);
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
  updated_at: string;
}

/** What anyone may see of a profile (the account id never leaves). */
export function publicProfile(p: ProfileRow, extra: { following?: boolean; followers?: number; name?: string | null; picture?: string | null; own?: boolean } = {}) {
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
    nowPlaying: fresh ? p.now_playing : null,
    updatedAt: p.updated_at,
    ...(extra.following !== undefined ? { following: extra.following } : {}),
    ...(extra.followers !== undefined ? { followers: extra.followers } : {}),
    // The owner also sees their own sharing switch; nobody else does.
    ...(extra.own ? { shareNow: p.share_now } : {}),
  };
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
