/**
 * Disco lights — the phone itself: its flashlight on the beat, and (in the
 * Android app) its screen at full brightness with the system bars away.
 *
 * Flashlight, best route first:
 *  1. the Android app's own plugin (`VinaxDisco`, native-android/DiscoPlugin.java):
 *     switches the flashlight directly, opens no camera, asks nothing;
 *  2. the camera's torch through the page (`getUserMedia` + the `torch`
 *     constraint): Chrome on Android, and Safari on recent iPhones. It asks
 *     for the camera once; nothing is recorded or sent anywhere, and the
 *     camera stops the moment the flashlight is turned off.
 * Anything else (a computer, an older iPhone) has no flashlight to offer and
 * the button says so.
 *
 * Flashes are cut to TORCH_GAP_MS apart (under three a second), like the
 * screen's flash, and each lasts TORCH_HOLD_MS.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export const DISCO_PLUGIN = 'VinaxDisco';
/** Never more than three flashlight flashes a second. */
export const TORCH_GAP_MS = 340;
/** How long the flashlight stays on per beat. */
export const TORCH_HOLD_MS = 110;

interface DiscoNative {
  torchAvailable(): Promise<{ available: boolean }>;
  torch(opts: { on: boolean }): Promise<void>;
  brightness(opts: { on: boolean }): Promise<void>;
  bars(opts: { hidden: boolean }): Promise<void>;
}

const native = registerPlugin<DiscoNative>(DISCO_PLUGIN);

/** True only in an Android app built with the plugin. */
export function discoPluginAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(DISCO_PLUGIN);
  } catch {
    return false;
  }
}

export interface Torch {
  readonly kind: 'native' | 'camera';
  set(on: boolean): void;
  close(): void;
}

/** `torch` is in the image-capture spec, not yet in TypeScript's DOM types. */
const torchSet = (on: boolean): MediaTrackConstraintSet => ({ torch: on }) as unknown as MediaTrackConstraintSet;

type TorchTrack = MediaStreamTrack & { getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean } };

/** Open the flashlight, or null when this device has none the app can use. Call from a tap. */
export async function openTorch(): Promise<Torch | null> {
  if (discoPluginAvailable()) {
    try {
      const { available } = await native.torchAvailable();
      if (available) {
        return {
          kind: 'native',
          set: (on) => void native.torch({ on }).catch(() => undefined),
          close: () => void native.torch({ on: false }).catch(() => undefined),
        };
      }
    } catch {
      /* fall through to the camera route */
    }
  }
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!media?.getUserMedia) return null;
  let stream: MediaStream | null = null;
  try {
    stream = await media.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const track = stream.getVideoTracks()[0] as TorchTrack | undefined;
    if (!track) throw new Error('no camera');
    const caps = track.getCapabilities?.();
    // Chrome lists `torch`; Safari may not list it but still honours it, so try it either way.
    if (caps && 'torch' in caps && !caps.torch) throw new Error('no torch');
    await track.applyConstraints({ advanced: [torchSet(true)] });
    await track.applyConstraints({ advanced: [torchSet(false)] });
    const s = stream;
    return {
      kind: 'camera',
      set: (on) => void track.applyConstraints({ advanced: [torchSet(on)] }).catch(() => undefined),
      close: () => s.getTracks().forEach((t) => t.stop()),
    };
  } catch {
    stream?.getTracks().forEach((t) => t.stop());
    return null;
  }
}

/**
 * Turns beats into flashlight flashes: on at a beat, off TORCH_HOLD_MS
 * later, never closer than TORCH_GAP_MS. Pure timing over a `set` callback
 * and a timer, so it can be tested with fake ones.
 */
export class TorchPulser {
  private last = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly set: (on: boolean) => void;
  private readonly gap: number;
  private readonly hold: number;
  flashes = 0;

  constructor(set: (on: boolean) => void, gap = TORCH_GAP_MS, hold = TORCH_HOLD_MS) {
    this.set = set;
    this.gap = gap;
    this.hold = hold;
  }

  /** A beat at `now` (ms). Returns true when it flashed. */
  beat(now: number): boolean {
    if (now - this.last < this.gap) return false;
    this.last = now;
    this.flashes += 1;
    this.set(true);
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.set(false);
    }, this.hold);
    return true;
  }

  /** Off now, and no flash pending. */
  stop(): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    this.set(false);
  }
}

/** Android app: the screen at full brightness for this window (false: the phone's own level). No-op elsewhere. */
export function setMaxBrightness(on: boolean): void {
  if (discoPluginAvailable()) void native.brightness({ on }).catch(() => undefined);
}

/**
 * Android app: hide or show the status and navigation bars. Returns false
 * where the app cannot (the web, an older APK), so the page uses the
 * browser's full screen instead.
 */
export function setSystemBarsHidden(hidden: boolean): boolean {
  if (!discoPluginAvailable()) return false;
  void native.bars({ hidden }).catch(() => undefined);
  return true;
}
