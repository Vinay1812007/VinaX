/**
 * 15.0 — the social layer's client: profiles, follows, shared playlists and
 * shared chats (backend/worker/functions/api/{profile,follow,shared-playlist,
 * share-chat}.ts). Every call that writes needs the Google session; public
 * reads (a profile by handle, a public playlist, a shared chat) work signed
 * out. Nothing is cached here: the hooks in features/social do that.
 */
import type { Song } from '@/types';
import { currentAccount } from '@/services/auth/google';
import { isNativePlatform } from '@/services/native';

const ORIGIN = isNativePlatform() ? 'https://www.vinaxmusic.online' : '';
export const SOCIAL_BASE = `${ORIGIN}/api`;

export interface PublicProfile {
  handle: string;
  name: string | null;
  picture: string | null;
  bio: string | null;
  public: boolean;
  topArtists: Array<{ name: string; plays: number }>;
  topLanguages: Array<{ id: string; pct: number }>;
  recentLikes: LiteSong[];
  nowPlaying: LiteSong | null;
  updatedAt: string;
  following?: boolean;
  followers?: number;
  /** Only on the owner's own profile. */
  shareNow?: boolean;
}

/** What the server keeps of a song: enough to show and to look up again. */
export interface LiteSong { id: string; title?: string; subtitle?: string; image?: string; language?: string; year?: string | number; duration?: number; by?: string }

export interface SharedPlaylist {
  id: string;
  name: string;
  description: string | null;
  songs: LiteSong[];
  public: boolean;
  collab: boolean;
  version: number;
  owner: string | null;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SharedChat { id: string; title: string | null; messages: Array<{ role: 'user' | 'assistant'; content: string }>; model: string | null; createdAt: string; expiresAt: string }

export class SocialError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

/** A server answer is checked, never trusted: a cache, a proxy or an older
 *  Worker can hand back `{}`, and one missing array must not take Home down. */
function profileOrNull(raw: unknown): PublicProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<PublicProfile>;
  if (typeof p.handle !== 'string' || !p.handle) return null;
  return {
    ...(p as PublicProfile),
    name: typeof p.name === 'string' ? p.name : null,
    picture: typeof p.picture === 'string' ? p.picture : null,
    bio: typeof p.bio === 'string' ? p.bio : null,
    public: p.public === true,
    topArtists: Array.isArray(p.topArtists) ? p.topArtists : [],
    topLanguages: Array.isArray(p.topLanguages) ? p.topLanguages : [],
    recentLikes: Array.isArray(p.recentLikes) ? p.recentLikes.filter((x) => x && typeof x.id === 'string') : [],
    nowPlaying: p.nowPlaying && typeof p.nowPlaying.id === 'string' ? p.nowPlaying : null,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date(0).toISOString(),
  };
}

function isPlaylist(raw: unknown): raw is SharedPlaylist {
  const p = raw as Partial<SharedPlaylist> | null;
  return !!p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.songs);
}

async function call<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', 'x-vinax-client': isNativePlatform() ? 'app' : 'web' };
  if (init.body) headers['content-type'] = 'application/json';
  const account = currentAccount();
  if (account) headers.authorization = `Bearer ${account.session}`;
  else if (init.auth) throw new SocialError(401, 'signed_out');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(`${SOCIAL_BASE}${path}`, { ...init, headers, signal: ctl.signal });
    if (res.status === 204) return null as T;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new SocialError(res.status, typeof body.error === 'string' ? body.error : `http_${res.status}`);
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/** A song pared to what the server keeps (and what a public page shows). */
export function liteSong(s: Song): LiteSong {
  const image = s.images?.length ? s.images[s.images.length - 1]?.url : undefined;
  return { id: s.id, title: s.title, subtitle: s.subtitle, image, language: s.language ?? undefined, year: s.year ?? undefined, duration: s.duration ?? undefined };
}

// ---------------------------------------------------------------- profile
export interface ProfileWrite { handle?: string; public?: boolean; bio?: string | null; summary?: { topArtists: Array<{ name: string; plays: number }>; topLanguages: Array<{ id: string; pct: number }>; recentLikes: LiteSong[] }; nowPlaying?: LiteSong | null; shareNow?: boolean }

export const getMyProfile = () => call<{ profile?: PublicProfile } | null>('/profile', { auth: true }).then((r) => profileOrNull(r?.profile));
export const putMyProfile = (patch: ProfileWrite) => call<{ profile?: PublicProfile }>('/profile', { method: 'PUT', body: JSON.stringify(patch), auth: true }).then((r) => profileOrNull(r?.profile));
export const deleteMyProfile = () => call<null>('/profile', { method: 'DELETE', auth: true });
export const getProfile = (handle: string) => call<{ profile?: PublicProfile }>(`/profile/${encodeURIComponent(handle)}`).then((r) => {
  const p = profileOrNull(r?.profile);
  if (!p) throw new SocialError(404, 'not_found');
  return p;
});

// ---------------------------------------------------------------- follows
export const getFollowing = () => call<{ following?: unknown }>('/follow', { auth: true }).then((r) => (Array.isArray(r?.following) ? r.following : []).map(profileOrNull).filter((p): p is PublicProfile => !!p));
export const setFollow = (handle: string, on: boolean) => call<{ following?: boolean }>('/follow', { method: 'POST', body: JSON.stringify({ handle, on }), auth: true }).then((r) => r?.following === true);

// ------------------------------------------------------- shared playlists
export const listSharedPlaylists = () => call<{ playlists?: unknown }>('/shared-playlist', { auth: true }).then((r) => (Array.isArray(r?.playlists) ? r.playlists : []).filter(isPlaylist));
export const writeSharedPlaylist = (body: { id?: string; name: string; description?: string | null; songs: LiteSong[]; public?: boolean; collab?: boolean; version?: number }) =>
  call<{ playlist: SharedPlaylist; collabToken?: string }>('/shared-playlist', { method: 'POST', body: JSON.stringify(body), auth: true });
export const deleteSharedPlaylist = (id: string) => call<null>(`/shared-playlist?id=${encodeURIComponent(id)}`, { method: 'DELETE', auth: true });
export const getSharedPlaylist = (id: string, token?: string | null) =>
  call<{ playlist?: unknown; canEdit?: boolean }>(`/shared-playlist/${encodeURIComponent(id)}${token ? `?token=${encodeURIComponent(token)}` : ''}`).then((r) => {
    if (!isPlaylist(r?.playlist)) throw new SocialError(404, 'not_found');
    return { playlist: r.playlist, canEdit: r.canEdit === true };
  });
export const collabAdd = (id: string, token: string, song: LiteSong, by?: string) => call<{ playlist: SharedPlaylist }>(`/shared-playlist/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ token, add: song, by }) }).then((r) => r.playlist);
export const collabRemove = (id: string, token: string, songId: string) => call<{ playlist: SharedPlaylist }>(`/shared-playlist/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ token, remove: songId }) }).then((r) => r.playlist);

// ------------------------------------------------------------ shared chats
export const shareChat = (body: { title?: string | null; model?: string | null; messages: Array<{ role: 'user' | 'assistant'; content: string }> }) => call<{ id: string; url: string; expiresAt: string }>('/share-chat', { method: 'POST', body: JSON.stringify(body), auth: true });
export const getSharedChat = (id: string) =>
  call<Partial<SharedChat>>(`/share-chat/${encodeURIComponent(id)}`).then((r): SharedChat => {
    const messages = Array.isArray(r?.messages) ? r.messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') : null;
    if (!r || typeof r.id !== 'string' || !messages) throw new SocialError(404, 'not_found');
    return { id: r.id, title: typeof r.title === 'string' ? r.title : null, messages, model: typeof r.model === 'string' ? r.model : null, createdAt: String(r.createdAt ?? ''), expiresAt: String(r.expiresAt ?? '') };
  });
export const deleteSharedChat = (id: string) => call<null>(`/share-chat?id=${encodeURIComponent(id)}`, { method: 'DELETE', auth: true });
