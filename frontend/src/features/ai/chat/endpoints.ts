import { isNativePlatform } from '@/services/native';

/** The app build talks to the production origin; the web build is same-origin. */
const ORIGIN = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';

export const CHAT_ENDPOINT = `${ORIGIN}/api/vinaxai`;
/** The live model catalogue. Fetched only when the model menu first opens. */
export const MODELS_ENDPOINT = `${ORIGIN}/api/aimodels`;
/** Which speech models the key serves right now. */
export const VOICES_ENDPOINT = `${ORIGIN}/api/voices`;
export const IMAGE_ENDPOINT = `${ORIGIN}/api/image`;
/** 10.3 — a short music clip from a prompt. */
export const MUSIC_ENDPOINT = `${ORIGIN}/api/music`;
/** 10.3 — recorded speech to text, for the composer's mic when a server
 *  dictation model is chosen. */
export const TRANSCRIBE_ENDPOINT = `${ORIGIN}/api/transcribe`;

// 10.3 — `IMAGES_ENABLED` is gone: Create image (and Create music clip) show
// when GET /api/aimodels says the feature exists (`features.image`, `.music`).

export const clientHeaders = (): Record<string, string> => (isNativePlatform() ? { 'x-vinax-client': 'app' } : {});
