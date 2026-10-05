import { isNativePlatform } from '@/services/native';

/** The app build talks to the production origin; the web build is same-origin. */
const ORIGIN = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';

export const CHAT_ENDPOINT = `${ORIGIN}/api/vinaxai`;
/** The live model catalogue. Fetched only when the model menu first opens. */
export const MODELS_ENDPOINT = `${ORIGIN}/api/aimodels`;
/** Which speech models the key serves right now. */
export const VOICES_ENDPOINT = `${ORIGIN}/api/voices`;
export const IMAGE_ENDPOINT = `${ORIGIN}/api/image`;

let lastWarm = 0;
/**
 * 10.1 — wake the web search engine as soon as it is wanted. It sleeps when
 * idle and takes up to a minute to wake; switching on Web search or Research
 * starts that now, while the question is still being typed. Fire and forget,
 * at most once every two minutes.
 */
export function warmWebSearch(now: number = Date.now()): void {
  if (now - lastWarm < 120_000) return;
  lastWarm = now;
  void fetch(`${ORIGIN}/api/warm-search`, { method: 'POST', keepalive: true }).catch(() => undefined);
}
/** Flip to true the day the account gets a real image model — the whole
 *  pipeline (endpoint, chat branch, button) is wired and waiting. */
export const IMAGES_ENABLED = false;

export const clientHeaders = (): Record<string, string> => (isNativePlatform() ? { 'x-vinax-client': 'app' } : {});
