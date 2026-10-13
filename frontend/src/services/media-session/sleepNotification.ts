/**
 * 13.0.2 — the sleep timer on the playback notification.
 *
 * Watches the player store's three sleep states (a clock, "end of this
 * song", "after N songs") and mirrors them as one short line in the native
 * notification's sub-text through setSleepNotificationLabel. A clock timer
 * counts down, so while one runs the line is refreshed every half-minute;
 * the bridge itself drops unchanged labels, so most refreshes cost nothing.
 *
 * Loaded from AppLayout's idle init (native only) — never in first-load.
 */
import { usePlayerStore } from '@/store/playerStore';
import { setSleepNotificationLabel } from './index';

/** The notification line for a sleep state; '' when no timer is set. */
export function sleepLine(sleepAt: number | null, afterTrack: boolean, songsLeft: number, now = Date.now()): string {
  if (afterTrack) return 'Sleeps after this song';
  if (songsLeft > 0) return songsLeft === 1 ? 'Sleeps after this song' : `Sleeps after ${songsLeft} songs`;
  if (sleepAt != null) {
    const m = Math.max(1, Math.ceil((sleepAt - now) / 60_000));
    return `Sleeps in ${m} min`;
  }
  return '';
}

let installed = false;
let tick: number | null = null;

export function initSleepNotification(): void {
  if (installed) return;
  installed = true;
  const push = (): void => {
    const { sleepAt, sleepAfterTrack, sleepSongsLeft } = usePlayerStore.getState();
    setSleepNotificationLabel(sleepLine(sleepAt, sleepAfterTrack, sleepSongsLeft));
    // The clock line counts down: keep a slow tick only while one runs.
    const wants = sleepAt != null;
    if (wants && tick == null) tick = window.setInterval(push, 30_000);
    if (!wants && tick != null) {
      window.clearInterval(tick);
      tick = null;
    }
  };
  usePlayerStore.subscribe((s, prev) => {
    if (s.sleepAt !== prev.sleepAt || s.sleepAfterTrack !== prev.sleepAfterTrack || s.sleepSongsLeft !== prev.sleepSongsLeft) push();
  });
  push();
}
