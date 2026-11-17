import type { Song } from '@/types';
import { recommendFromSeeds } from '@/services/recs/similar';

/**
 * "Recommended songs" under one of your playlists, like Spotify's playlist
 * footer. Plain catalogue lookups (the Worker's similar-song ranking through
 * services/recs/similar.ts), no AI: a few of the playlist's own songs are the
 * seeds, and what comes back is shown minus what the playlist already holds.
 *
 * Refresh moves to the next round: other seeds from the playlist, and the
 * songs already shown are left out so the list really changes.
 */

/** The route takes five seeds at most. */
export const MAX_SEEDS = 5;
/** Rows shown at once. */
export const SHOWN = 10;
/** Asked for per round, so rows added to the playlist are replaced from the spare ones. */
export const FETCH_LIMIT = 20;
/** The route reads 100 exclude ids at most; the seeds take up to five of those. */
const EXCLUDE_CAP = 95;

function artistKey(song: Song): string {
  return (song.artists[0]?.id || song.artists[0]?.name || song.subtitle || song.id).toLowerCase();
}

/**
 * Up to `n` seeds for round `round`: as many different artists as the
 * playlist has, a different slice of them each round, and a different song
 * of each artist when the rounds come back around. Deterministic, so a test
 * (and the listener) gets the same seeds for the same round.
 */
export function pickSeeds(songs: readonly Song[], round: number, n = MAX_SEEDS): Song[] {
  const seen = new Set<string>();
  const groups = new Map<string, Song[]>();
  for (const s of songs) {
    if (!s?.id || seen.has(s.id)) continue;
    seen.add(s.id);
    const key = artistKey(s);
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const list = [...groups.values()];
  const g = list.length;
  if (!g || n <= 0) return [];
  const r = Math.max(0, Math.floor(round));
  const start = (r * n) % g;
  const cycle = Math.floor((r * n) / g);
  const longest = Math.max(...list.map((x) => x.length));
  const picks: Song[] = [];
  const chosen = new Set<string>();
  for (let pass = 0; pass < longest && picks.length < n; pass++) {
    for (let k = 0; k < g && picks.length < n; k++) {
      const group = list[(start + k) % g];
      if (pass >= group.length) continue;
      const song = group[(cycle + pass) % group.length];
      if (chosen.has(song.id)) continue;
      chosen.add(song.id);
      picks.push(song);
    }
  }
  return picks;
}

/** Ids for the route to leave out: the songs already shown first (so Refresh changes the list), then the playlist. */
export function excludeIds(playlist: readonly Song[], shown: Iterable<string>): string[] {
  const out = new Set<string>(shown);
  for (const s of playlist) out.add(s.id);
  return [...out].slice(0, EXCLUDE_CAP);
}

/** What the footer shows: not in the playlist, allowed right now (hidden, blocked, Kid mode), first `max`. */
export function visibleRecs(recs: readonly Song[], playlist: readonly Song[], allowed: (s: Song) => boolean, max = SHOWN): Song[] {
  const inPlaylist = new Set(playlist.map((s) => s.id));
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const s of recs) {
    if (out.length >= max) break;
    if (inPlaylist.has(s.id) || seen.has(s.id) || !allowed(s)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/**
 * One round of recommendations for a playlist. The server's exclude list is
 * capped, so the playlist is filtered here too. Songs shown in an earlier
 * round are dropped when there are new ones; when there are none, the round
 * shows what it found rather than nothing.
 */
export async function fetchPlaylistRecs(playlist: readonly Song[], round: number, shown: ReadonlySet<string>, signal?: AbortSignal): Promise<Song[]> {
  const seeds = pickSeeds(playlist, round);
  if (!seeds.length) return [];
  const songs = await recommendFromSeeds(seeds, { limit: FETCH_LIMIT, exclude: excludeIds(playlist, shown), signal });
  const inPlaylist = new Set(playlist.map((s) => s.id));
  const found = songs.filter((s) => s?.id && !inPlaylist.has(s.id));
  const fresh = found.filter((s) => !shown.has(s.id));
  return fresh.length ? fresh : found;
}
