import { useMemo } from 'react';
import { Shelf } from '@/components/Shelf';
import { PlayIcon } from '@/components/Icons';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { continueListening, progressFraction, timeLeft, useEpisodeProgress, type EpisodeProgress } from './progress';
import '@/styles/pages/tracklist.css';
import '@/styles/pages/podcasts.css';

/** One episode you started: its art with a progress line, its title, the show and the time left. Tap to go on. */
function ContinueCard({ entry }: { entry: EpisodeProgress }) {
  const { song } = entry;
  const isCurrent = usePlayerStore((s) => s.queue[s.index]?.id === song.id);
  const show = song.album?.name || song.subtitle;
  const left = timeLeft(entry);
  const resume = (): void => {
    const player = usePlayerStore.getState();
    // Already the episode in the player: carry on from where it is.
    if (isCurrent) {
      if (!player.isPlaying) player.togglePlay();
      return;
    }
    player.playSong(song, { startAt: entry.sec });
  };
  return (
    <article className="vx-media-card vx-continue-card w-40 sm:w-44 shrink-0" data-song-id={song.id}>
      <button type="button" className="vx-continue-play" aria-label={`Resume ${song.title}, ${left}`} onClick={resume}>
        <span className="vx-media-art">
          <img
            src={bestImage(song.images, 250)}
            onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
            alt=""
            loading="lazy"
            decoding="async"
            width={160}
            height={160}
            className="w-full aspect-square object-cover"
          />
          <span className="vx-continue-glyph" aria-hidden><PlayIcon /></span>
          <span className="vx-episode-progress vx-continue-bar" aria-hidden>
            <i style={{ width: `${Math.round(progressFraction(entry) * 100)}%` }} />
          </span>
        </span>
        <span className="vx-media-title">{song.title}</span>
        <span className="vx-media-subtitle">{[show, left].filter(Boolean).join(' · ')}</span>
      </button>
    </article>
  );
}

/**
 * Continue your shows: the episodes you started and did not finish, most
 * recent first (features/podcasts/progress). Nothing shows until there is one.
 */
export function ContinueShows() {
  const map = useEpisodeProgress();
  const items = useMemo(() => continueListening(map), [map]);
  if (!items.length) return null;
  return (
    <Shelf title="Continue your shows">
      {items.map((e) => (
        <ContinueCard key={e.song.id} entry={e} />
      ))}
    </Shelf>
  );
}
