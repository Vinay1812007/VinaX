import { useEffect, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { ClockIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';

const SLEEP_MINUTES = [15, 30, 60];
const SLEEP_SONGS = [3, 5, 10];

/** Whole minutes left on a clock timer (at least 1 while it runs). */
const minutesLeft = (at: number): number => Math.max(1, Math.ceil((at - Date.now()) / 60_000));

interface SleepSummary {
  active: boolean;
  /** A few characters for the tool-row badge. */
  short: string;
  /** The button's accessible name. */
  spoken: string;
  /** One sentence for the sheet. */
  sentence: string;
}

/**
 * The sleep timer's state in words — the same three ways it can be set:
 * a clock, the end of this song, or a number of songs.
 */
function useSleepSummary(): SleepSummary {
  const sleepAt = usePlayerStore((s) => s.sleepAt);
  const afterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const songsLeft = usePlayerStore((s) => s.sleepSongsLeft);
  // A clock timer's label counts down: re-read it every 20 s while one runs.
  const [, tick] = useState(0);
  useEffect(() => {
    if (sleepAt == null) return;
    const t = window.setInterval(() => tick((n) => n + 1), 20_000);
    return () => window.clearInterval(t);
  }, [sleepAt]);
  if (afterTrack) {
    return { active: true, short: 'End', spoken: 'Sleep timer: stops at the end of this song', sentence: 'Playback stops at the end of this song.' };
  }
  if (songsLeft > 0) {
    const n = `${songsLeft} song${songsLeft === 1 ? '' : 's'}`;
    return { active: true, short: `${songsLeft} left`, spoken: `Sleep timer: stops after ${n}`, sentence: `Playback stops after ${n}.` };
  }
  if (sleepAt != null) {
    const m = minutesLeft(sleepAt);
    const mins = `${m} minute${m === 1 ? '' : 's'}`;
    return { active: true, short: `${m}m`, spoken: `Sleep timer: ${mins} left`, sentence: `Playback stops in ${mins}.` };
  }
  return { active: false, short: '', spoken: 'Sleep timer', sentence: 'Playback stops by itself when the timer ends.' };
}

/**
 * The tool-row button. Off, it is a clock; on, it turns Iris and says how
 * long is left, so the listener never has to open the sheet to find out.
 */
export function SleepTimerButton({ onOpen, open }: { onOpen: () => void; open: boolean }) {
  const { active, short, spoken } = useSleepSummary();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={spoken}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={spoken}
      className={cn('vx-np-tool', active && 'is-on')}
    >
      <ClockIcon />
      {active && (
        <span className="vx-np-tool-badge tabular-nums" aria-hidden>
          {short}
        </span>
      )}
    </button>
  );
}

/**
 * The sleep rows — a clock (15 / 30 / 60 min, end of song) and "after N
 * songs" — shared by the sleep sheet and the player's More options sheet, so
 * there is one implementation wherever the listener finds them.
 */
export function SleepTimerOptions() {
  const sleepAt = usePlayerStore((s) => s.sleepAt);
  const afterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const songsLeft = usePlayerStore((s) => s.sleepSongsLeft);
  const { setSleepTimer, setSleepAfterTrack, setSleepSongs } = usePlayerStore.getState();
  return (
    <>
      <div className="vx-np-opt">
        <span className="vx-np-opt-label">Sleep timer</span>
        <div className="vx-np-opt-controls" role="group" aria-label="Sleep timer">
          {SLEEP_MINUTES.map((m) => (
            <button key={m} type="button" onClick={() => setSleepTimer(m)} className="vx-np-pill">
              {m}m
            </button>
          ))}
          <button type="button" onClick={() => setSleepAfterTrack(!afterTrack)} aria-pressed={afterTrack} className="vx-np-pill">
            End of song
          </button>
          {sleepAt != null && (
            <button type="button" onClick={() => setSleepTimer(null)} className="vx-np-pill is-on">
              Cancel ({minutesLeft(sleepAt)}m)
            </button>
          )}
        </div>
      </div>
      {/* v5.12.0 — sleep after N songs */}
      <div className="vx-np-opt">
        <span className="vx-np-opt-label">Sleep after songs</span>
        <div className="vx-np-opt-controls" role="group" aria-label="Sleep after songs">
          {SLEEP_SONGS.map((n) => (
            <button key={n} type="button" onClick={() => setSleepSongs(songsLeft === n ? 0 : n)} aria-pressed={songsLeft === n} className="vx-np-pill">
              {n}
            </button>
          ))}
          {songsLeft > 0 && <span className="vx-np-opt-value tabular-nums">{songsLeft} left</span>}
        </div>
      </div>
    </>
  );
}

/** The sheet the tool-row button opens: where the timer stands, the options, and one way to stop it. */
export function SleepTimerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { active, sentence } = useSleepSummary();
  const cancelAll = () => {
    const { setSleepTimer, setSleepAfterTrack, setSleepSongs } = usePlayerStore.getState();
    setSleepTimer(null);
    setSleepAfterTrack(false);
    setSleepSongs(0);
  };
  return (
    <Sheet open={open} onClose={onClose} labelledBy="vx-np-sleep-title" size="md" className="vx-np-opts">
      <SheetHeader id="vx-np-sleep-title" title="Sleep timer" subtitle={<span role="status">{sentence}</span>} onClose={onClose} />
      <SleepTimerOptions />
      {active && (
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Turn it off</span>
          <div className="vx-np-opt-controls">
            <button type="button" onClick={cancelAll} className="vx-np-pill is-quiet">
              Cancel sleep timer
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
