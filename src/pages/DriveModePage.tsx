import { createPortal } from 'react-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, ChevronDownIcon } from '@/components/Icons';
import { EmptyState } from '@/components/States';
import { Link } from 'react-router-dom';

/** Big-target, low-distraction player for driving / hands-busy use. */
export default function DriveModePage() {
  usePageTitle('Drive Mode');
  const song = useCurrentSong();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const { togglePlay, next, prev } = usePlayerStore.getState();
  const navigate = useNavigate();

  if (!song) {
    return <EmptyState title="Nothing playing" message="Start a song, then switch to Drive Mode." action={<Link to="/" className="px-5 py-2.5 rounded-full btn-primary">Browse</Link>} />;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-ink-950 flex flex-col items-center justify-center px-6 text-center">
      <button onClick={() => navigate(-1)} aria-label="Exit Drive Mode" className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 p-3 text-ink-300">
        <ChevronDownIcon className="w-8 h-8" />
      </button>
      <img src={bestImage(song.images, 300)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-44 h-44 rounded-3xl object-cover shadow-float mb-8" />
      <h1 className="text-3xl font-extrabold leading-tight line-clamp-2">{song.title}</h1>
      <p className="text-lg text-ink-300 mt-2 truncate max-w-full">{song.subtitle}</p>

      <div className="flex items-center justify-center gap-6 mt-12 w-full">
        <button onClick={prev} aria-label="Previous" className="w-24 h-24 rounded-full bg-ink-800 active:bg-ink-700 flex items-center justify-center">
          <PrevIcon className="w-12 h-12 text-ink-100" />
        </button>
        <button onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className="w-32 h-32 rounded-full btn-primary flex items-center justify-center active:scale-95 transition-transform shadow-glow">
          {isPlaying ? <PauseIcon className="w-16 h-16" /> : <PlayIcon className="w-16 h-16 ml-2" />}
        </button>
        <button onClick={() => next(true)} aria-label="Next" className="w-24 h-24 rounded-full bg-ink-800 active:bg-ink-700 flex items-center justify-center">
          <NextIcon className="w-12 h-12 text-ink-100" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
