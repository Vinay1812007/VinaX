/**
 * 15.0 — "Songs like this" and seeded recommendations from the Worker's
 * catalogue-ranked routes (`/api/recommendations/similar/:id` and
 * `/api/recommendations?seeds=`; backend/worker/functions/_lib/recs.ts).
 * Both were built in 14.x and never called (docs/ai-music.md § Known gaps);
 * this module is their client.
 *
 * The routes return light `RecTrack`s (id, title, artist, a reason line).
 * Playback needs the catalogue's full `Song`, so each id is resolved through
 * `getSong` and the reason is kept in the reason store, where the queue, the
 * ⋮ menu's "Why this song?" and Now Playing's About tab read it. On any
 * failure (route down, rate-limited, offline) the catalogue's own
 * suggestions stand in, so the buttons always do something.
 */
import type { Song } from '@/types';
import { getSong, getSongSuggestions } from '@/services/api';
import { isNativePlatform } from '@/services/native';
import { useReasonStore } from '@/store/reasonStore';
import { useSettingsStore } from '@/store/settingsStore';

const BASE = isNativePlatform() ? 'https://www.vinaxmusic.online/api' : '/api';

interface RecTrack {
  id: string;
  title: string;
  artist: string;
  reason: 'similar' | 'same_artist';
  reasonText: string;
  seedId: string;
}

interface SimilarResponse { tracks?: RecTrack[] }

export interface SimilarOptions {
  limit?: number;
  /** Catalogue languages to stay within; defaults to the listener's pinned languages. */
  languages?: string[];
  signal?: AbortSignal;
}

function languagesParam(opts?: SimilarOptions): string {
  const langs = opts?.languages ?? useSettingsStore.getState().pinnedLanguages ?? [];
  return langs.length ? `&languages=${encodeURIComponent(langs.join(','))}` : '';
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9_000);
  signal?.addEventListener('abort', () => ctl.abort(), { once: true });
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json', 'x-vinax-client': isNativePlatform() ? 'app' : 'web' } });
    if (!res.ok) throw new Error(`recs ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve light tracks to playable songs, keeping their reasons; drops what the catalogue cannot find. */
async function resolve(tracks: RecTrack[], limit: number, signal?: AbortSignal): Promise<Song[]> {
  const wanted = tracks.slice(0, limit);
  const songs = await Promise.all(wanted.map((t) => getSong(t.id, { signal, priority: 'background' }).catch(() => null)));
  const out: Song[] = [];
  const reasons: Array<[string, string]> = [];
  for (let i = 0; i < wanted.length; i++) {
    const s = songs[i];
    if (!s) continue;
    out.push(s);
    if (wanted[i].reasonText) reasons.push([s.id, wanted[i].reasonText]);
  }
  useReasonStore.getState().setReasons(reasons);
  return out;
}

/**
 * Songs like `song`: the Worker's ranked list, or the catalogue's own
 * suggestions when the route is unavailable. Never throws; an empty list
 * means nothing could be found either way.
 */
export async function songsLikeThis(song: Song, opts: SimilarOptions = {}): Promise<Song[]> {
  const limit = Math.max(1, Math.min(30, opts.limit ?? 12));
  try {
    const json = await fetchJson<SimilarResponse>(`${BASE}/recommendations/similar/${encodeURIComponent(song.id)}?limit=${limit}${languagesParam(opts)}`, opts.signal);
    const tracks = (json.tracks ?? []).filter((t) => t && t.id && t.id !== song.id);
    if (tracks.length) {
      const songs = await resolve(tracks, limit, opts.signal);
      if (songs.length) return songs;
    }
  } catch {
    /* fall through to the catalogue */
  }
  try {
    const songs = (await getSongSuggestions(song.id, limit, { signal: opts.signal })).filter((s) => s.id !== song.id);
    useReasonStore.getState().fillReasons(songs.map((s) => [s.id, `Because you played ${song.title}`]));
    return songs;
  } catch {
    return [];
  }
}

/**
 * Recommendations from up to five seed songs (the listener's recent likes,
 * say), with ids to leave out. Same fallback as `songsLikeThis`, seeded from
 * the first song.
 */
export async function recommendFromSeeds(seeds: Song[], opts: SimilarOptions & { exclude?: string[] } = {}): Promise<Song[]> {
  const use = seeds.slice(0, 5);
  if (!use.length) return [];
  const limit = Math.max(1, Math.min(30, opts.limit ?? 10));
  const exclude = new Set(opts.exclude ?? []);
  for (const s of use) exclude.add(s.id);
  try {
    const q = `seeds=${encodeURIComponent(use.map((s) => s.id).join(','))}&limit=${limit}${languagesParam(opts)}${exclude.size ? `&exclude=${encodeURIComponent([...exclude].slice(0, 100).join(','))}` : ''}`;
    const json = await fetchJson<SimilarResponse>(`${BASE}/recommendations?${q}`, opts.signal);
    const tracks = (json.tracks ?? []).filter((t) => t && t.id && !exclude.has(t.id));
    if (tracks.length) {
      const songs = await resolve(tracks, limit, opts.signal);
      if (songs.length) return songs;
    }
  } catch {
    /* fall through */
  }
  const fallback = await songsLikeThis(use[0], { ...opts, limit });
  return fallback.filter((s) => !exclude.has(s.id)).slice(0, limit);
}
