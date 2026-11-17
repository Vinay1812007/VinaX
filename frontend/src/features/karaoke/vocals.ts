/**
 * Karaoke vocals: why the Vocals control cannot work right now, in one plain
 * line (null when it can). The sound itself is shaped by the vocals stage of
 * the lazy effects chain (services/audio/effects.ts).
 */
export interface VocalsContext {
  /** iPhone or iPad in Safari: the engine never builds the chain there. */
  ios: boolean;
  /** Casting: the song plays on the other screen, not through this device. */
  casting: boolean;
  /** The browser has Web Audio at all. */
  webAudio: boolean;
  /** The chain heard silence from this song's source and stepped aside. */
  bypassed: boolean;
}

export const VOCALS_HINT = 'Lowers the voice mixed in the middle. A song in mono goes almost silent.';

export function vocalsBlocked(c: VocalsContext): string | null {
  if (c.ios) return 'Vocals can’t be changed in Safari on iPhone or iPad. The Android app and computers can.';
  if (!c.webAudio) return 'This browser can’t change the vocals.';
  if (c.casting) return 'Vocals can’t be changed while casting.';
  if (c.bypassed) return 'This song’s sound can’t be changed here, so the vocals stay in.';
  return null;
}
