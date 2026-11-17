/**
 * A cast session, the same for both senders (./web.ts and ./native.ts):
 * the handoff when it starts, the phone's sound back when it ends, and the
 * receiver's reports moving the phone's silent clock. Loaded with a sender,
 * never in the first load.
 */
import { usePlayerStore } from '@/store/playerStore';
import { audioEngine } from '@/services/audio/engine';
import { useCastStore, castSync, castSend, castDevError } from './index';

/** The phone's silent clock follows the receiver once they are this far apart (a seek on the TV). */
export const CAST_DRIFT_S = 3;

/** A cast session started or resumed: the receiver takes over the current song where it is. */
export function castSessionStarted(deviceName: string | null): void {
  useCastStore.setState({ connected: true, deviceName });
  const { queue, index, isPlaying, currentTime, volume } = usePlayerStore.getState();
  const song = queue[index];
  if (!song) return;
  // Mute the phone BEFORE the receiver starts, so the two never play at once;
  // a failed load gives the phone its sound back instead of leaving it silent.
  const prev = volume;
  audioEngine.setVolume(0);
  const sent = castSend(song, isPlaying, currentTime);
  if (!sent) {
    audioEngine.setVolume(prev);
    return;
  }
  sent.catch((e) => {
    audioEngine.setVolume(usePlayerStore.getState().volume);
    castDevError('Cast load failed:', e);
  });
}

export function castSessionEnded(): void {
  useCastStore.setState({ connected: false, deviceName: null });
  castSync.sentUrl = null;
  castSync.remotePlaying = null;
  audioEngine.setVolume(usePlayerStore.getState().volume);
}

const fresh = (url: string | null | undefined): boolean =>
  useCastStore.getState().connected && !!url && url === castSync.sentUrl && Date.now() >= castSync.quietUntil;

/** The receiver's position (seconds): shown on the seek bar, and a seek on the TV moves the phone's clock too. */
export function castRemoteTime(seconds: number, url: string | null | undefined, playing: boolean): void {
  if (!Number.isFinite(seconds) || !fresh(url)) return;
  usePlayerStore.setState({ currentTime: seconds });
  const local = audioEngine.position();
  if (playing && local != null && Math.abs(local - seconds) > CAST_DRIFT_S) audioEngine.seek(seconds);
}

/**
 * The receiver played or paused (the TV's remote, a voice speaker): the
 * phone's clock follows, or left running it would reach the end of a paused
 * song and start the next one. Only a change is acted on, so a pause on the
 * phone alone (a sleep timer) is not undone by the TV's next report.
 */
export function castRemotePlaying(playing: boolean, url: string | null | undefined): void {
  if (!fresh(url) || playing === castSync.remotePlaying) return;
  castSync.remotePlaying = playing;
  if (usePlayerStore.getState().isPlaying === playing) return;
  if (playing) audioEngine.play();
  else audioEngine.pause();
  usePlayerStore.setState({ isPlaying: playing });
}
