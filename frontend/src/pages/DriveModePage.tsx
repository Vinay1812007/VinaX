import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, ChevronDownIcon } from '@/components/Icons';
import { EmptyState } from '@/components/States';
import { Link } from 'react-router-dom';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import '@/styles/pages/player.css';

/**
 * Big-target, low-distraction player for driving / hands-busy use: the
 * artwork, the song, and three squircles — previous, play (Iris), next —
 * each far larger than a fingertip. Styled in styles/pages/player.css.
 */
export default function DriveModePage() {
  usePageTitle('Drive Mode');
  const song = useCurrentSong();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const { togglePlay, next, prev } = usePlayerStore.getState();
  const navigate = useNavigate();
  // Full-screen portal = modal: Tab stays inside, Escape exits, focus goes back to the opener.
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, !!song, () => navigate(-1));

  if (!song) {
    return <EmptyState title="Nothing playing" message="Start a song, then switch to Drive Mode." action={<Link to="/" className="vx-tap px-5 py-2.5 rounded-full btn-primary">Browse</Link>} />;
  }

  return createPortal(
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Drive Mode" className="vx-drive">
      <button type="button" onClick={() => navigate(-1)} aria-label="Exit Drive Mode" className="vx-drive-close">
        <ChevronDownIcon />
      </button>
      <img src={bestImage(song.images, 300)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="vx-drive-art" />
      <h1 className="vx-drive-title line-clamp-2">{song.title}</h1>
      <p className="vx-drive-artist">{song.subtitle}</p>

      <div className="vx-drive-transport">
        <button type="button" onClick={prev} aria-label="Previous" className="vx-drive-skip">
          <PrevIcon />
        </button>
        <button type="button" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className="vx-drive-play">
          {isPlaying ? <PauseIcon /> : <PlayIcon className="ml-1.5" />}
        </button>
        <button type="button" onClick={() => next(true)} aria-label="Next" className="vx-drive-skip">
          <NextIcon />
        </button>
      </div>
    </div>,
    document.body,
  );
}
