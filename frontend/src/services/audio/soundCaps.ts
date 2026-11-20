/**
 * 1.19.2 — what this device can do for "Spatial audio" and "Dolby Atmos", so
 * Settings › Sound and the Playback sheet show those rows only where they
 * mean something.
 *
 * Android app: native-android/SoundCapsPlugin.java (the phone's Spatializer,
 * Dolby's audio effect or settings app, a Dolby Atmos decoder).
 * Browser: Media Capabilities with `spatialRendering` — a browser that says
 * it can render Dolby (E-AC-3) audio spatially (Safari on Apple devices) has
 * spatial audio. A browser has no Dolby settings to open, so Dolby Atmos is
 * an Android-app row only.
 *
 * Asked once per launch; the answer is cached.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNativePlatform } from '@/services/native';

export interface SoundCaps {
  /** The device can render spatial audio: offer the Spatial audio switch. */
  spatial: boolean;
  /** Android: the phone has Dolby Atmos (show the row with its settings link). */
  dolby: boolean;
}

export const NO_CAPS: SoundCaps = { spatial: false, dolby: false };

interface SoundCapsPlugin {
  caps(): Promise<{ spatial?: boolean; spatialAvailable?: boolean; spatialEnabled?: boolean; dolby?: boolean; dolbyApp?: boolean }>;
  openDolby(): Promise<{ opened?: string }>;
}

const PLUGIN = 'VinaxSoundCaps';
let plugin: SoundCapsPlugin | null = null;
function native(): SoundCapsPlugin | null {
  if (!isNativePlatform() || !Capacitor.isPluginAvailable(PLUGIN)) return null;
  plugin ??= registerPlugin<SoundCapsPlugin>(PLUGIN);
  return plugin;
}

type DecodingInfo = (config: unknown) => Promise<{ supported?: boolean }>;

/** A browser that can render Dolby audio spatially (Safari with spatial audio). */
export async function webSpatial(mc: { decodingInfo?: DecodingInfo } | undefined = typeof navigator !== 'undefined' ? (navigator as unknown as { mediaCapabilities?: { decodingInfo?: DecodingInfo } }).mediaCapabilities : undefined): Promise<boolean> {
  if (!mc || typeof mc.decodingInfo !== 'function') return false;
  try {
    const r = await mc.decodingInfo({
      type: 'file',
      audio: { contentType: 'audio/mp4; codecs="ec-3"', channels: '16', bitrate: 768_000, samplerate: 48_000, spatialRendering: true },
    });
    return r?.supported === true;
  } catch {
    return false;
  }
}

let cached: Promise<SoundCaps> | null = null;

export function detectSoundCaps(): Promise<SoundCaps> {
  cached ??= (async (): Promise<SoundCaps> => {
    const p = native();
    if (p) {
      try {
        const c = await p.caps();
        return { spatial: c.spatial === true, dolby: c.dolby === true };
      } catch {
        return NO_CAPS;
      }
    }
    if (isNativePlatform()) return NO_CAPS;
    return { ...NO_CAPS, spatial: await webSpatial() };
  })();
  return cached;
}

/** Open the phone's Dolby Atmos settings (or its sound settings). False when it could not. */
export async function openDolbySettings(): Promise<boolean> {
  const p = native();
  if (!p) return false;
  try {
    await p.openDolby();
    return true;
  } catch {
    return false;
  }
}

/** @internal — tests. */
export function resetSoundCapsForTest(): void {
  cached = null;
  plugin = null;
}
