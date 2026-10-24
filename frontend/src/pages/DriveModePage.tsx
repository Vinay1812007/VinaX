import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, ChevronDownIcon, MicIcon } from '@/components/Icons';
import { useDictation } from '@/features/ai/chat/useDictation';
import { tryMusicCommand } from '@/features/ai/chat/musicCommands';
import { cn } from '@/utils/cn';
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

  // 15.0 — a voice button: "play Srivalli", "next", "pause", "queue Kesariya",
  // "play something in Telugu". The same on-device command parser VinaX AI
  // uses (musicCommands.ts) runs the words; the reply is spoken back, since
  // the eyes are on the road.
  const [heard, setHeard] = useState<string>('');
  const [reply, setReply] = useState<string>('');
  const say = useCallback((line: string) => {
    setReply(line);
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(line);
      u.rate = 1.05;
      synth.speak(u);
    } catch {
      /* no speech on this device: the line is on screen */
    }
  }, []);
  const onText = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setHeard(t);
      void tryMusicCommand(t, say).then((handled) => {
        if (!handled) say(`Try "play", "next", "pause", or "play" and a song or artist`);
      });
    },
    [say],
  );
  const dictation = useDictation(onText);

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

      <div className="vx-drive-voice">
        <button
          type="button"
          onClick={dictation.listening ? dictation.stop : dictation.start}
          aria-pressed={dictation.listening}
          aria-label={dictation.listening ? 'Stop listening' : 'Voice command'}
          className={cn('vx-drive-mic', dictation.listening && 'is-live')}
        >
          <MicIcon />
        </button>
        <p className="vx-drive-voice-line" role="status" aria-live="polite">
          {dictation.listening ? 'Listening… say "play", "next", "pause" or a song' : reply || dictation.note || (heard ? `Heard: ${heard}` : 'Tap the mic and say what to play')}
        </p>
      </div>
    </div>,
    document.body,
  );
}
