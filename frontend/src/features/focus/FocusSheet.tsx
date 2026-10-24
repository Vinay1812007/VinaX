import { useEffect, useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { FOCUS_MINUTES, FOCUS_SOUNDS, useFocusStore, type FocusSound } from '@/features/focus/focusSounds';
import { cn } from '@/utils/cn';

/**
 * 15.0 — the Focus sounds sheet, opened from Now Playing → Player tools.
 * Pick a texture and how long it should play; the sound sits beside the
 * music at its own volume and fades out when the time is up.
 */
export function FocusSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sound = useFocusStore((s) => s.sound);
  const volume = useFocusStore((s) => s.volume);
  const until = useFocusStore((s) => s.until);
  const [minutes, setMinutes] = useState<number>(30);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [until]);
  const left = until ? Math.max(1, Math.round((until - Date.now()) / 60_000)) : null;
  const sentence = sound
    ? `${FOCUS_SOUNDS.find((s) => s.id === sound)?.label ?? 'Sound'} is playing${left ? ` · ${left} min left` : ' until you stop it'}`
    : 'Nothing playing. Pick a sound and a time.';
  const start = (id: FocusSound) => useFocusStore.getState().start(id, minutes);
  return (
    <Sheet open={open} onClose={onClose} labelledBy="vx-focus-title" size="md" className="vx-np-opts">
      <SheetHeader id="vx-focus-title" title="Focus sounds" subtitle={<span role="status">{sentence}</span>} onClose={onClose} />
      <div className="vx-np-opt">
        <span className="vx-np-opt-label">Sound</span>
        <div className="vx-np-opt-controls" role="group" aria-label="Sound">
          {FOCUS_SOUNDS.map((s) => (
            <button key={s.id} type="button" title={s.hint} aria-pressed={sound === s.id} onClick={() => (sound === s.id ? useFocusStore.getState().stop() : start(s.id))} className={cn('vx-np-pill', sound === s.id && 'is-on')}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="vx-np-opt">
        <span className="vx-np-opt-label">For</span>
        <div className="vx-np-opt-controls" role="group" aria-label="How long">
          {FOCUS_MINUTES.map((m) => (
            <button key={m} type="button" aria-pressed={minutes === m} onClick={() => { setMinutes(m); if (sound) useFocusStore.getState().start(sound, m); }} className={cn('vx-np-pill', minutes === m && 'is-on')}>
              {m === 0 ? 'Until stopped' : `${m} min`}
            </button>
          ))}
        </div>
      </div>
      <div className="vx-np-opt">
        <label className="vx-np-opt-label" htmlFor="vx-focus-vol">Volume</label>
        <div className="vx-np-opt-controls">
          <input id="vx-focus-vol" type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => useFocusStore.getState().setVolume(Number(e.target.value) / 100)} aria-label="Focus sound volume" className="vx-np-range" />
        </div>
      </div>
      {sound && (
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Turn it off</span>
          <div className="vx-np-opt-controls">
            <button type="button" onClick={() => useFocusStore.getState().stop()} className="vx-np-pill is-quiet">Stop the sound</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
