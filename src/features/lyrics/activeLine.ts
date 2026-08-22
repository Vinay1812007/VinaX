import type { LrcLine } from '@/services/lyrics/lrclib';
import { useLyricsOffsetStore } from '@/store/lyricsOffsetStore';

/** Small lookahead so a line lights up right as it starts, hiding the
 *  ~250ms timeupdate cadence that feeds the player store. */
export const LYRIC_LOOKAHEAD_S = 0.2;

/**
 * Single source of truth for "which line is being sung right now" — every
 * lyric surface (player Lyrics tab, immersive view, Karaoke, rail strip,
 * chat player card, lock screen) computes its highlight through this.
 *
 * `offset` follows the store convention: positive shows lines LATER (use
 * when the lyrics run ahead of the music), negative earlier.
 * Returns -1 before the first line has started.
 */
export function activeLyricIndex(lines: LrcLine[], currentTime: number, offset = 0): number {
  const t = currentTime + LYRIC_LOOKAHEAD_S - offset;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Saved per-song sync offset — non-reactive read for services and memos
 *  that already re-run on time updates. */
export function lyricsOffsetFor(songId: string | null | undefined): number {
  return songId ? useLyricsOffsetStore.getState().offsets[songId] ?? 0 : 0;
}
