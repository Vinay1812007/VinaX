import { isNativePlatform } from '@/services/native';

/** The app build talks to the production origin; the web build is same-origin. */
const ORIGIN = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';

export const CHAT_ENDPOINT = `${ORIGIN}/api/vinaxai`;
/** The live model catalogue. Fetched only when the model menu first opens. */
export const MODELS_ENDPOINT = `${ORIGIN}/api/aimodels`;
/** Which speech models the key serves right now. */
export const VOICES_ENDPOINT = `${ORIGIN}/api/voices`;
export const IMAGE_ENDPOINT = `${ORIGIN}/api/image`;
/** Flip to true the day the account gets a real image model — the whole
 *  pipeline (endpoint, chat branch, button) is wired and waiting. */
export const IMAGES_ENABLED = false;

export const clientHeaders = (): Record<string, string> => (isNativePlatform() ? { 'x-vinax-client': 'app' } : {});
