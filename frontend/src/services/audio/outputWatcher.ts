import { create } from 'zustand';
import { toast } from '@/store/toastStore';
import { usePlayerStore } from '@/store/playerStore';

interface AudioOutputState {
  /** Friendly name of an external output, when one is connected & known. */
  externalLabel: string | null;
  setExternalLabel(label: string | null): void;
}

export const useAudioOutputStore = create<AudioOutputState>()((set) => ({
  externalLabel: null,
  setExternalLabel: (externalLabel) => set({ externalLabel }),
}));

const EXTERNAL_HINT = /bluetooth|headset|headphone|airpod|buds|earphone|usb|hdmi|cast/i;

async function snapshot(): Promise<{ count: number; external: string | null }> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === 'audiooutput');
    const external = outputs.find((d) => EXTERNAL_HINT.test(d.label));
    return { count: outputs.length, external: external?.label ?? null };
  } catch {
    return { count: 0, external: null };
  }
}

/**
 * device awareness: toast when an audio device connects or
 * disconnects, expose its name for the player UI, and pause playback when
 * the output disappears (so music never blasts from the phone speaker).
 * Browser privacy note: device labels may be empty without mic permission —
 * we degrade to a generic "audio device".
 */
export function initAudioOutputWatcher(): void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
  let last = { count: -1, external: null as string | null };

  const refresh = async (announce: boolean) => {
    const now = await snapshot();
    if (announce && last.count >= 0) {
      if (now.count > last.count) {
        const label = now.external ?? 'Audio device';
        toast(`🎧 Connected: ${label}`);
      } else if (now.count < last.count) {
        toast('Audio device disconnected');
        // Match platform convention: pause instead of switching to speaker.
        const p = usePlayerStore.getState();
        if (p.isPlaying) p.togglePlay();
      }
    }
    useAudioOutputStore.getState().setExternalLabel(now.external);
    last = now;
  };

  void refresh(false);
  // Bluetooth handoff emits a burst of devicechange events with an unstable
  // device list mid-negotiation. Debounce so we evaluate once it settles —
  // this prevents a spurious "disconnected" pause when buds connect.
  let settle: number | null = null;
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (settle != null) window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      settle = null;
      void refresh(true);
    }, 600);
  });
}
