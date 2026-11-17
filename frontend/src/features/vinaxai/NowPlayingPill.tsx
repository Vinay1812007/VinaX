/**
 * VinaX AI — music keeps playing: a compact now-playing pill in the header.
 * "Ask about this song" fills the composer with a question about it (never
 * sends), like the starter chips. It lives only here, inside /vinaxai: the
 * music side has no AI.
 */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentSong, usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';
import type { Song } from '@/types';
import { PauseSmallIcon, PlaySmallIcon, SparkIcon } from './icons';

/** The composer's text for "Ask about this song". */
export function askAboutSong(song: Pick<Song, 'title' | 'artists' | 'subtitle'>): string {
  const artist = song.artists?.slice(0, 2).map((a) => a.name).filter(Boolean).join(', ') || song.subtitle?.trim() || '';
  const title = song.title.trim();
  return artist ? `Tell me about ${title} by ${artist}` : `Tell me about ${title}`;
}

export function NowPlayingPill({ onAsk }: { onAsk?: (text: string) => void }): ReactNode {
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
      {onAsk && (
        <button type="button" className="vx-ai-np-ask" onClick={() => onAsk(askAboutSong(song))} aria-label="Ask about this song" title="Ask about this song">
          <SparkIcon className="w-4 h-4" />
        </button>
      )}
      <button type="button" className="vx-ai-np-toggle" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? <PauseSmallIcon className="w-4 h-4" /> : <PlaySmallIcon className="w-4 h-4" />}
      </button>
    </div>
  );
}
