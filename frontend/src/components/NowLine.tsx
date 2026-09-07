import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { activeLyricIndex, lyricsOffsetFor } from '@/features/lyrics/activeLine';

/**
 * v5.12.0 — the line being sung right now, under the desktop player bar's
 * seekbar. Its own component so the 4×/s clock only re-renders this strip,
 * never the whole bar. Silent when the song has no synced lyrics.
 */
export function NowLine() {
  const song = useCurrentSong();
  const currentTime = usePlayerStore((s) => s.currentTime);
  const { data } = useSyncedLyrics(song);
  const lines = data?.synced;
  if (!song || !lines?.length) return null;
  const i = activeLyricIndex(lines, currentTime, lyricsOffsetFor(song.id));
  const text = i >= 0 ? lines[i]?.text : '';
  if (!text) return null;
  return (
    <p className="mt-1 max-w-xl truncate text-center text-[11px] font-semibold text-ink-300 transition-opacity" aria-live="off">
      ♪ {text}
    </p>
  );
}
