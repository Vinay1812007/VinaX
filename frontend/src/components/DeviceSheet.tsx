import { useEffect, useState } from 'react';
import { audioEngine } from '@/services/audio/engine';
import { useOutputStore } from '@/store/outputStore';
import { useCastStore, ensureCastSdk } from '@/services/cast';
import { toast } from '@/store/toastStore';
import { isNativePlatform } from '@/services/native';
import { Sheet, SheetHeader } from './Sheet';
import { CheckIcon, DevicesIcon, VolumeIcon } from './Icons';
import { cn } from '@/utils/cn';

interface Device {
  deviceId: string;
  label: string;
}

/** A TV glyph for casting (local: the shared icon set has none). */
function TvIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
      <rect x="3" y="5" width="18" height="12" rx="2.5" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/**
 * "Connect to a device": route audio to any connected output (speakers or
 * headphones, through the browser's output switching) or cast to a TV.
 *
 * 9.0 — built on <Sheet>: dialog semantics, the focus trap, Escape, the
 * hardware back action and the body scroll lock all come from the one
 * overlay shell, like every other sheet in the app.
 */
export function DeviceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const sinkId = useOutputStore((s) => s.sinkId);
  const setOutput = useOutputStore((s) => s.setOutput);
  const castAvailable = useCastStore((s) => s.available);
  const castConnected = useCastStore((s) => s.connected);
  const castName = useCastStore((s) => s.deviceName);
  const supported =
    !isNativePlatform() &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.enumerateDevices;

  useEffect(() => {
    if (open) ensureCastSdk();
  }, [open]);

  useEffect(() => {
    if (!open || !supported) return;
    let alive = true;
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        if (!alive) return;
        const outs = list
          .filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Audio device ${i + 1}` }));
        setDevices(outs);
      })
      .catch(() => alive && setDevices([]));
    return () => {
      alive = false;
    };
  }, [open, supported]);

  const pick = async (id: string, label: string) => {
    const ok = await audioEngine.setOutputDevice(id);
    if (ok) {
      setOutput(id, label);
      toast(`Playing on ${label}`);
      onClose();
    } else {
      toast('Could not switch to that device');
    }
  };

  const castToTv = () => {
    const w = window as unknown as {
      cast?: { framework?: { CastContext?: { getInstance?: () => { requestSession?: () => void } } } };
    };
    try {
      w.cast?.framework?.CastContext?.getInstance?.().requestSession?.();
    } catch {
      toast('Cast unavailable');
    }
    onClose();
  };

  const row = (active: boolean) =>
    cn(
      'relative w-full flex items-center gap-3 min-h-[52px] px-3 rounded-2xl text-left text-[15px] transition-colors',
      active ? 'bg-ember-500/15 text-ember-400 font-semibold' : 'text-ink-100 hover:bg-ink-100/[0.06]',
    );
  const glyph = 'w-9 h-9 rounded-xl grid place-items-center shrink-0 bg-ink-100/[0.08]';

  return (
    <Sheet open={open} onClose={onClose} labelledBy="vx-device-title" size="sm">
      <SheetHeader id="vx-device-title" title="Connect to a device" subtitle="Play VinaX on another output." onClose={onClose} />
      <ul className="mt-3 space-y-1" aria-label="Outputs">
        <li>
          <button type="button" onClick={() => void pick('', 'This device')} aria-pressed={sinkId === ''} className={row(sinkId === '')}>
            <span className={glyph} aria-hidden>
              <VolumeIcon className="w-5 h-5" />
            </span>
            <span className="min-w-0 flex-1 truncate">This device</span>
            {sinkId === '' && <CheckIcon className="w-5 h-5 shrink-0" />}
          </button>
        </li>
        {devices.map((d) => (
          <li key={d.deviceId}>
            <button type="button" onClick={() => void pick(d.deviceId, d.label)} aria-pressed={sinkId === d.deviceId} className={row(sinkId === d.deviceId)}>
              <span className={glyph} aria-hidden>
                <DevicesIcon className="w-5 h-5" />
              </span>
              <span className="min-w-0 flex-1 truncate">{d.label}</span>
              {sinkId === d.deviceId && <CheckIcon className="w-5 h-5 shrink-0" />}
            </button>
          </li>
        ))}
        {castAvailable && (
          <li>
            <button type="button" onClick={castToTv} className={row(false)}>
              <span className={cn(glyph, castConnected && 'text-tide-400')} aria-hidden>
                <TvIcon />
              </span>
              <span className="min-w-0 flex-1 truncate">Cast to a TV{castConnected && castName ? ` · ${castName}` : ''}</span>
            </button>
          </li>
        )}
      </ul>

      <p className="text-[12px] text-ink-400 mt-4 leading-relaxed">
        Bluetooth speakers and headphones: pair them in your device’s system settings, then pick them here. If the browser asks for a one-time permission, allow it — that’s how it unlocks output switching.
        {!supported && ' Output switching isn’t available in this app or browser — pairing in system settings still routes audio.'}
      </p>
    </Sheet>
  );
}
