import type { Song } from '@/types';
import { recommendFromSeeds } from '@/services/recs/similar';
import { trendingSeed } from '@/constants/seeds';
import { getArtistTopSongs, getSongSuggestions, searchSongs } from '@/services/api/saavn';
import { songKey } from '@/services/recommendation/songKey';
import { isValidSong } from '@/store/playerGuards';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isEpisode } from '@/features/podcasts/episode';

/**
 * 1.20 — Autoplay, the way Spotify does it: when the album, playlist or song
 * the listener played runs out, play songs like the ones they just heard, so
 * the music does not stop.
 *
 * Seeds are the last few songs played (the playing one first). Podcast
 * episodes are not seeds and never get Autoplay.
 *
 * 1.20.1 — it never stops for want of songs. Candidates come from, in order:
 * the Worker's "songs like these" route, the catalogue's own suggestions for
 * each of the first seeds, the lead artist's songs, and popular songs in the
 * seed's language. They are filtered in steps, taking the first step that
 * finds enough: nothing played in the last RECENT_PLAYS plays, then nothing
 * in the last SHORT_RECENT, then only nothing still waiting in the queue.
 * Hidden songs, muted languages and explicit songs under Kid mode are never
 * picked, at any step. Each song once, by identity.
 *
 * Loaded on demand by the player store: it is not part of the first load.
 */

/** How many songs one Autoplay top-up adds. */
export const AUTOPLAY_BATCH = 10;
/** How many seed songs are sent. */
export const AUTOPLAY_SEEDS = 5;
/** First choice: nothing from this many recent plays. */
export const RECENT_PLAYS = 50;
/** Second choice: nothing from this many. */
export const SHORT_RECENT = 10;
/** Enough songs to stop widening. */
const ENOUGH = 3;

/** Can this song be an Autoplay pick right now? Read at call time, so a song hidden mid-request never gets in. */
export function allowedForAutoplay(song: Song): boolean {
  if (!isValidSong(song) || isEpisode(song)) return false;
  const settings = useSettingsStore.getState();
  if (settings.kidMode && song.explicit) return false;
  if (song.language && settings.mutedLanguages.includes(song.language)) return false;
  return !isSongBlocked(song, useLibraryStore.getState());
}

/** The seeds: the playing song and the songs played just before it, newest first, no episodes. */
export function autoplaySeeds(queue: readonly Song[], index: number): Song[] {
  const out: Song[] = [];
  const seen = new Set<string>();
  for (let i = Math.min(index, queue.length - 1); i >= 0 && out.length < AUTOPLAY_SEEDS; i -= 1) {
    const s = queue[i];
    if (!s || isEpisode(s) || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/**
 * Keep the songs Autoplay may add, in order, each once. `recent`: how many of
 * the latest plays to leave out (0 = none). `avoid`: queue entries to leave
 * out (by default the whole queue).
 */
export function pickAutoplay(
  candidates: readonly Song[],
  queue: readonly Song[],
  limit = AUTOPLAY_BATCH,
  opts: { recent?: number; avoid?: readonly Song[] } = {},
): Song[] {
  const avoid = opts.avoid ?? queue;
  const ids = new Set(avoid.map((s) => s.id));
  const keys = new Set(avoid.map(songKey));
  const titles = new Set(avoid.map(baseTitle).filter(Boolean));
  for (const e of useHistoryStore.getState().entries.slice(0, opts.recent ?? RECENT_PLAYS)) {
    ids.add(e.song.id);
    keys.add(songKey(e.song));
    const t = baseTitle(e.song);
    if (t) titles.add(t);
  }
  const out: Song[] = [];
  for (const s of candidates) {
    if (out.length >= limit) break;
    if (!allowedForAutoplay(s) || ids.has(s.id)) continue;
    const key = songKey(s);
    const title = baseTitle(s);
    if (keys.has(key) || (title && titles.has(title))) continue;
    ids.add(s.id);
    keys.add(key);
    if (title) titles.add(title);
    out.push(s);
  }
  return out;
}

/**
 * 1.20.1 — the song's name without what is in brackets ("Yeshanagula (From
 * \"The Paradise\") (Telugu)" → "yeshanagula"): two versions of one song are
 * one pick.
 */
export function baseTitle(song: Pick<Song, 'title'>): string {
  return (song.title || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The filter steps, strictest first. The last one only keeps what is still waiting in the queue out. */
function pickWidening(candidates: readonly Song[], queue: readonly Song[]): Song[] {
  const strict = pickAutoplay(candidates, queue, AUTOPLAY_BATCH, { recent: RECENT_PLAYS });
  if (strict.length >= ENOUGH) return strict;
  const short = pickAutoplay(candidates, queue, AUTOPLAY_BATCH, { recent: SHORT_RECENT });
  if (short.length >= ENOUGH) return short;
  return pickAutoplay(candidates, queue, AUTOPLAY_BATCH, { recent: 0, avoid: queue.slice(-SHORT_RECENT) });
}

const none = (): Song[] => [];

/**
 * The next Autoplay songs after `queue[index]`. Never throws; an empty list
 * only when the catalogue answered nothing at all.
 */
export async function findAutoplaySongs(queue: readonly Song[], index: number, signal?: AbortSignal): Promise<Song[]> {
  const seeds = autoplaySeeds(queue, index);
  if (!seeds.length) return [];
  const exclude = [...new Set([...queue.map((s) => s.id), ...useHistoryStore.getState().entries.slice(0, RECENT_PLAYS).map((e) => e.song.id)])];
  const ask = AUTOPLAY_BATCH * 2;
  const pool: Song[] = [];
  // Every source is tried for songs not heard lately before any recent song is let back in.
  const fresh = (songs: readonly Song[]): boolean => {
    pool.push(...songs);
    return pickAutoplay(pool, queue, AUTOPLAY_BATCH, { recent: RECENT_PLAYS }).length >= ENOUGH;
  };
  const done = (): Song[] => (signal?.aborted ? [] : pickWidening(pool, queue));

  // 1. The Worker's ranked "songs like these".
  if (fresh(await recommendFromSeeds(seeds, { limit: ask, exclude, signal }).catch(none)) || signal?.aborted) return done();
  // 2. The catalogue's suggestions for the first three seeds.
  const suggested = await Promise.all(seeds.slice(0, 3).map((s) => getSongSuggestions(s.id, ask, { signal, priority: 'background' }).catch(none)));
  if (fresh(suggested.flat()) || signal?.aborted) return done();
  // 3. The lead artist's songs.
  const artistId = seeds.map((s) => s.artists?.[0]?.id).find(Boolean);
  if (artistId && (fresh(await getArtistTopSongs(artistId, 0).catch(none)) || signal?.aborted)) return done();
  // 4. Popular songs in the seed's language.
  const language = seeds.map((s) => s.language).find((l) => l && l !== 'unknown');
  if (language) fresh(await searchSongs(trendingSeed(language, queue.length), ask, { signal, priority: 'background' }).catch(none));
  return done();
}
