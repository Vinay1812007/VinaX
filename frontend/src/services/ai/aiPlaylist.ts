import type { Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';
import { searchSongs } from '@/services/api/saavn';
import { songKey } from '@/services/recommendation/songKey';
import { postMusicAi } from './musicAi';
import { buildTasteSummary } from './tasteSummary';
import { recentPlays, resolvePicks, type SongPick } from './suggest';

/**
 * AI Playlist: describe a vibe in plain words, get a playlist.
 *
 * The music AI proposes songs by title and artist (POST /api/ai/playlist);
 * each is resolved to a real catalogue track (./suggest.ts), then songs in a
 * muted language and songs played in the last RECENT_DAYS are dropped. When
 * the AI is slow, away or switched off, or finds too few real songs, the
 * list is built from a catalogue search for the same words, with the same
 * filters, so the listener always gets something to play or save.
 */

export const PLAYLIST_DEADLINE_MS = 12_000;
export const RECENT_DAYS = 7;
/** Fewer real songs than this from the AI and the catalogue search takes over. */
export const MIN_AI_SONGS = 5;

export interface AiPlaylistSong {
  song: Song;
  reason: string | null;
}

export interface AiPlaylistResult {
  title: string;
  songs: AiPlaylistSong[];
  /** 'ai' = the AI's picks; 'search' = the catalogue search fallback. */
  source: 'ai' | 'search';
}

export interface AiPlaylistOptions {
  count?: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  search?: (q: string, limit: number, signal?: AbortSignal) => Promise<Song[]>;
  now?: number;
}

/** The songs a playlist must leave out: muted languages, and anything played in the last RECENT_DAYS. */
export function playlistFilter(ctx: RecommendationContext, now = Date.now()): (song: Song) => boolean {
  const muted = new Set((ctx.mutedLanguages ?? []).map((l) => l.toLowerCase()));
  const since = now - RECENT_DAYS * 86_400_000;
  const recent = new Set<string>();
  for (const e of ctx.history ?? []) {
    if (e?.song && e.ts >= since) {
      recent.add(e.song.id);
      recent.add(songKey(e.song));
    }
  }
  return (song) => !(song.language && muted.has(song.language.toLowerCase())) && !recent.has(song.id) && !recent.has(songKey(song)) && !song.generated;
}

/** Title-case the first letter of a fallback title. */
const titleOf = (prompt: string): string => {
  const t = prompt.trim().replace(/\s+/g, ' ').slice(0, 40);
  return t ? t[0].toUpperCase() + t.slice(1) : 'Your playlist';
};

export async function makeAiPlaylist(prompt: string, ctx: RecommendationContext, o: AiPlaylistOptions = {}): Promise<AiPlaylistResult> {
  const count = Math.max(10, Math.min(30, o.count ?? 20));
  const keep = playlistFilter(ctx, o.now);
  const search = o.search ?? ((q: string, limit: number, signal?: AbortSignal) => searchSongs(q, limit, { signal }));
  const answer = await postMusicAi<{ title?: unknown; songs?: unknown }>(
    'playlist',
    { prompt: prompt.trim().slice(0, 200), count, recent: recentPlays(ctx.history, 10), taste: buildTasteSummary(ctx) },
    { deadlineMs: PLAYLIST_DEADLINE_MS, signal: o.signal, fetcher: o.fetcher },
  );
  if (answer && Array.isArray(answer.songs) && !o.signal?.aborted) {
    const picks: SongPick[] = answer.songs
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({ title: typeof x.title === 'string' ? x.title : '', artist: typeof x.artist === 'string' ? x.artist : '', reason: typeof x.reason === 'string' ? x.reason.trim().slice(0, 90) : null }))
      .filter((p) => p.title && p.artist)
      .slice(0, count);
    const found = (await resolvePicks(picks, { signal: o.signal, search })).filter(({ song }) => keep(song));
    if (found.length >= MIN_AI_SONGS) {
      return {
        title: typeof answer.title === 'string' && answer.title.trim() ? answer.title.trim().slice(0, 40) : titleOf(prompt),
        songs: found.map(({ song, pick }) => ({ song, reason: pick.reason ?? null })),
        source: 'ai',
      };
    }
  }
  if (o.signal?.aborted) return { title: titleOf(prompt), songs: [], source: 'search' };
  const results = await search(prompt.trim().slice(0, 120), 40, o.signal).catch(() => [] as Song[]);
  const seen = new Set<string>();
  const songs = results
    .filter((s) => {
      const k = songKey(s);
      if (!s?.id || seen.has(k) || !keep(s)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, count)
    .map((song) => ({ song, reason: null }));
  return { title: titleOf(prompt), songs, source: 'search' };
}
