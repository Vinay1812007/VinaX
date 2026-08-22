import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { fetchLrclibLyrics, type LrcLine } from '@/services/lyrics/lrclib';
import { activeLyricIndex, lyricsOffsetFor } from '@/features/lyrics/activeLine';
import { setLockScreenLyricLine } from '@/services/media-session';
import type { Song } from '@/types';

/**
 * Drives synced lyrics onto the lock-screen / notification media player as a
 * song plays (the current line replaces the artist text). Runs in
 * the background regardless of whether the in-app lyrics view is open. Native
 * only; a no-op when the "Lock screen lyrics" setting is off or no synced
 * lyrics exist.
 */
let lines: LrcLine[] | null = null;
let songId: string | null = null;
let activeIdx = -1;
let fetchToken = 0;

async function loadFor(song: Song): Promise<void> {
  const token = ++fetchToken;
  lines = null;
  const artist = song.artists[0]?.name ?? song.subtitle;
  const res = await fetchLrclibLyrics(song.title, artist, song.duration).catch(() => null);
  if (token !== fetchToken) return; // a newer song superseded this fetch
  lines = res?.synced ?? null;
}

let started = false;
export function initLockScreenLyrics(): void {
  if (started) return;
  started = true;

  usePlayerStore.subscribe((s) => {
    if (!useSettingsStore.getState().lockScreenLyrics) {
      if (activeIdx !== -1) {
        activeIdx = -1;
        setLockScreenLyricLine(null);
      }
      return;
    }

    const song = s.queue[s.index] ?? null;
    if (!song) return;

    if (song.id !== songId) {
      songId = song.id;
      activeIdx = -1;
      setLockScreenLyricLine(null); // restore artist until the new song's lyrics load
      void loadFor(song);
      return;
    }

    if (!lines || !lines.length) return;
    // Shared index math + the user's saved sync nudge (glanceable surface:
    // keep a slightly larger lookahead on top of the shared one).
    const idx = activeLyricIndex(lines, s.currentTime + 0.1, lyricsOffsetFor(songId));
    if (idx !== activeIdx) {
      activeIdx = idx;
      setLockScreenLyricLine(idx >= 0 ? lines[idx].text : null);
    }
  });
}
