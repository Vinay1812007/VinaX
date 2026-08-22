import { usePlayerStore, useCurrentSong } from '@/store/playerStore';

/** Visually-hidden polite live region so screen readers announce track + state changes. */
export function NowPlayingAnnouncer() {
  const song = useCurrentSong();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const text = song
    ? `${isPlaying ? 'Now playing' : 'Paused'}: ${song.title}${song.subtitle ? ` by ${song.subtitle}` : ''}`
    : '';
  return (
    <div aria-live="polite" role="status" className="sr-only">
      {text}
    </div>
  );
}
