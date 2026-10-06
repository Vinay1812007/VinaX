/**
 * 10.3 — the Settings → Voice choice, as one string on its long-standing key.
 *
 *   'device'                   this device's own voice (the default)
 *   'provider|model|voice'     one voice of one speech model (10.3)
 *   'model|voice'              what builds before 10.3 stored — every speech
 *                              model then came from one provider, so it reads
 *                              as that provider's, and is rewritten once in
 *                              the new shape: a listener keeps their voice.
 *
 * Tiny and dependency-free: the DJ voice reads it at boot.
 */
export const VOICE_PICK_KEY = 'vinax.aiVoice';
export const DEVICE_VOICE = 'device';
/** The provider every studio voice came from before 10.3. */
export const LEGACY_VOICE_PROVIDER = 'groq';

export interface VoicePick {
  provider: string;
  model: string;
  voice: string;
}

/** A stored value → a voice, or null for this device's voice. */
export function parseVoicePick(v: string | null | undefined): VoicePick | null {
  if (!v || v === DEVICE_VOICE) return null;
  const parts = v.split('|');
  if (parts.length === 2 && parts[0] && parts[1]) return { provider: LEGACY_VOICE_PROVIDER, model: parts[0], voice: parts[1] };
  if (parts.length === 3 && parts.every(Boolean)) return { provider: parts[0], model: parts[1], voice: parts[2] };
  return null;
}

export const formatVoicePick = (p: VoicePick): string => `${p.provider}|${p.model}|${p.voice}`;

/** The value in the 10.3 shape: an older build's 'model|voice' gains its
 *  provider; anything unreadable becomes the device voice. */
export function migrateVoicePick(v: string | null | undefined): string {
  const p = parseVoicePick(v);
  return p ? formatVoicePick(p) : DEVICE_VOICE;
}

/** The stored choice (migrated on the device the first time it is read). */
export function readVoicePick(): VoicePick | null {
  try {
    const raw = window.localStorage.getItem(VOICE_PICK_KEY);
    if (raw && raw !== DEVICE_VOICE) {
      const next = migrateVoicePick(raw);
      if (next !== raw) window.localStorage.setItem(VOICE_PICK_KEY, next);
    }
    return parseVoicePick(raw);
  } catch {
    return null;
  }
}
