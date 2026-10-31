/**
 * VinaX AI — music steps aside while voice is in use, then comes back.
 *
 *   holdMusic('pause')  the microphone is open (dictation, Live): music pauses.
 *   holdMusic('duck')   VinaX AI is speaking (read aloud): music plays on, quietly.
 *
 * Each call returns its release. Holds stack, and only the last release
 * puts things back: music resumes only if a hold paused it and nothing else
 * started or stopped it since, and the volume goes back to the listener's
 * own (a volume change during the hold wins). While casting, the receiver
 * owns the volume, so a duck leaves it alone.
 */
import { usePlayerStore } from '@/store/playerStore';
import { audioEngine } from '@/services/audio/engine';
import { useCastStore } from '@/services/cast';

/** How loud ducked music plays, as a share of the listener's volume. */
export const DUCK_LEVEL = 0.2;

let pauses = 0;
let ducks = 0;
/** The song a hold paused (resumed only if it is still the one loaded and still paused). */
let pausedSong: string | null = null;
let ducked = false;

const current = () => {
  const p = usePlayerStore.getState();
  return { p, songId: p.queue[p.index]?.id ?? null };
};

function duckNow(): void {
  // Also when paused: music the listener starts mid-sentence starts quietly.
  if (ducked || useCastStore.getState().connected) return;
  audioEngine.setVolume(usePlayerStore.getState().volume * DUCK_LEVEL);
  ducked = true;
}

function unduck(): void {
  if (!ducked) return;
  ducked = false;
  if (!useCastStore.getState().connected) audioEngine.setVolume(usePlayerStore.getState().volume);
}

export function holdMusic(kind: 'pause' | 'duck'): () => void {
  if (kind === 'pause') {
    pauses += 1;
    if (pauses === 1) {
      const { p, songId } = current();
      if (p.isPlaying && songId) {
        pausedSong = songId;
        p.togglePlay();
      }
    }
  } else {
    ducks += 1;
    if (ducks === 1 && pauses === 0) duckNow();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (kind === 'pause') pauses = Math.max(0, pauses - 1);
    else ducks = Math.max(0, ducks - 1);
    if (ducks === 0) unduck();
    if (pauses === 0 && pausedSong) {
      const { p, songId } = current();
      const resume = !p.isPlaying && songId === pausedSong;
      pausedSong = null;
      if (resume) p.togglePlay();
      if (ducks > 0) duckNow();
    }
  };
}

/** Test seam. */
export function _resetMusicHold(): void {
  pauses = 0;
  ducks = 0;
  pausedSong = null;
  ducked = false;
}
