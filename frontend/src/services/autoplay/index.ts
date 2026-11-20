import type { Song } from '@/types';
import { recommendFromSeeds, songsLikeThis } from '@/services/recs/similar';
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
 * One rule set, kept small on purpose:
 *  - Seeds are the last few songs played (the playing one first). Podcast
 *    episodes are not seeds and never get Autoplay.
 *  - Songs come from the Worker's "songs like these" route, or the
 *    catalogue's own suggestions for the playing song when that is down.
 *  - Nothing already in the queue, nothing played in the last
 *    RECENT_PLAYS plays, nothing hidden, no muted language, and no explicit
 *    song under Kid mode. Each song once, by identity (another cut of the same
 *    recording counts as the same song).
 *
 * Loaded on demand by the player store: it is not part of the first load.
 */

/** How many songs one Autoplay top-up adds. */
export const AUTOPLAY_BATCH = 10;
/** How many seed songs are sent. */
export const AUTOPLAY_SEEDS = 5;
/** Songs in this many recent plays are not picked again. */
export const RECENT_PLAYS = 50;

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

/** Keep the songs Autoplay may add, in order, each once. */
export function pickAutoplay(candidates: readonly Song[], queue: readonly Song[], limit = AUTOPLAY_BATCH): Song[] {
  const ids = new Set(queue.map((s) => s.id));
  const keys = new Set(queue.map(songKey));
  for (const e of useHistoryStore.getState().entries.slice(0, RECENT_PLAYS)) {
    ids.add(e.song.id);
    keys.add(songKey(e.song));
  }
  const out: Song[] = [];
  for (const s of candidates) {
    if (out.length >= limit) break;
    if (!allowedForAutoplay(s) || ids.has(s.id)) continue;
    const key = songKey(s);
    if (keys.has(key)) continue;
    ids.add(s.id);
    keys.add(key);
    out.push(s);
  }
  return out;
}

/**
 * The next Autoplay songs after `queue[index]`. Never throws; an empty list
 * means nothing new could be found.
 */
export async function findAutoplaySongs(queue: readonly Song[], index: number, signal?: AbortSignal): Promise<Song[]> {
  const seeds = autoplaySeeds(queue, index);
  if (!seeds.length) return [];
  const exclude = [...new Set([...queue.map((s) => s.id), ...useHistoryStore.getState().entries.slice(0, RECENT_PLAYS).map((e) => e.song.id)])];
  // Ask for more than one batch: some of what comes back is filtered out here.
  const ask = AUTOPLAY_BATCH * 2;
  let found = pickAutoplay(await recommendFromSeeds(seeds, { limit: ask, exclude, signal }).catch(() => [] as Song[]), queue);
  if (found.length < 3 && !signal?.aborted) {
    const more = await songsLikeThis(seeds[0], { limit: ask, signal }).catch(() => [] as Song[]);
    found = pickAutoplay([...found, ...more], queue);
  }
  return signal?.aborted ? [] : found;
}
