/** VinaX AI — music keeps playing: a compact now-playing pill in the header. */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentSong, usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';
import { PauseSmallIcon, PlaySmallIcon } from './icons';

export function NowPlayingPill(): ReactNode {
  const song = useCurrentSong();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const navigate = useNavigate();
  if (!song) return null;
  return (
    <div className="vx-ai-np">
      <button type="button" className="vx-ai-np-open" onClick={() => navigate('/now-playing')} aria-label={`Now playing: ${song.title}. Open the player`}>
        <img src={bestImage(song.images, 60)} alt="" width={28} height={28} loading="lazy" />
        <span className="vx-ai-np-title">{song.title}</span>
      </button>
      <button type="button" className="vx-ai-np-toggle" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? <PauseSmallIcon className="w-4 h-4" /> : <PlaySmallIcon className="w-4 h-4" />}
      </button>
    </div>
  );
}
