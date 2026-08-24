import { useEffect, useState, useRef } from 'react';
import { audioEngine } from '@/services/audio/engine';
import { useOutputStore } from '@/store/outputStore';
import { useCastStore, ensureCastSdk } from '@/services/cast';
import { toast } from '@/store/toastStore';
import { isNativePlatform } from '@/services/native';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface Device {
  deviceId: string;
  label: string;
}

/** "Connect to a device": route audio to any connected output
 *  (speakers/headphones via setSinkId) or cast to a TV (Chromecast). */
export function DeviceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useDismissOnBack(open, onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open, onClose);
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

  if (!open) return null;

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
    'w-full flex items-center justify-between gap-3 px-3 py-3 rounded-xl text-left text-sm transition-colors ' +
    (active ? 'bg-ember-500/15 text-ember-300 font-semibold' : 'hover:bg-ink-800 text-ink-100');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Connect to a device" className="glass-sheet relative w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl p-4 max-h-[80vh] overflow-y-auto">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-600/60 sm:hidden" aria-hidden />
        <h2 className="text-lg font-bold">Connect to a device</h2>
        <p className="text-xs text-ink-400 mb-3">Play VinaX on another output.</p>

        <div className="space-y-1">
          <button onClick={() => pick('', 'This device')} className={row(sinkId === '')}>
            <span>🔊 This device</span>
            {sinkId === '' && <span>✓</span>}
          </button>
          {devices.map((d) => (
            <button key={d.deviceId} onClick={() => pick(d.deviceId, d.label)} className={row(sinkId === d.deviceId)}>
              <span className="truncate">{d.label}</span>
              {sinkId === d.deviceId && <span>✓</span>}
            </button>
          ))}
          {castAvailable && (
            <button onClick={castToTv} className={row(false)}>
              <span>📺 Cast to TV{castConnected && castName ? ` · ${castName}` : ''}</span>
            </button>
          )}
        </div>

        <p className="text-[11px] text-ink-500 mt-4 leading-relaxed">
          Bluetooth speakers &amp; AirPods: pair them in your device&apos;s system settings, then pick them here. If the browser asks for a one-time permission, allow it — that&apos;s how Chrome unlocks output switching.
          {!supported && ' Output switching isn’t available in this app/browser — pairing in system settings still routes audio.'}
        </p>
      </div>
    </div>
  );
}
