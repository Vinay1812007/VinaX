/** The browser's on-device speech route (Chrome 139+ `processLocally`).
 *  Speech recognition stays on the device or in the browser's own speech
 *  service; VinaX sends no audio anywhere. */
import { Capacitor } from '@capacitor/core';
import { recognitionCtor } from './stt';

/** Chrome 139+ statics for the on-device speech model. */
interface RecognitionStatics {
  available?(opts: { langs: string[]; processLocally?: boolean }): Promise<string>;
  install?(opts: { langs: string[]; processLocally?: boolean }): Promise<boolean>;
}

/* ---------- on-device recognition route (voice search, Drive mode commands) ----------
 *
 * Diagnosed live (Chrome 150/macOS): Google's SERVER speech route can be
 * silently dead — a started recognizer fires a bare `end` instantly, no
 * `start`, no error, forever. The Web Speech on-device route
 * (`processLocally`, Chrome 139+) keeps working once its model is installed.
 * We prepare that route inside the user's tap (install() needs a gesture),
 * prefer it whenever ready, and detect the instant-end signature to fail over
 * or fail honestly instead of hanging on a dead "Listening…" state.
 */
export type LocalRouteState = 'unknown' | 'no-api' | 'checking' | 'installing' | 'ready' | 'unavailable';

let localRoute: LocalRouteState = 'unknown';

export function localRecognitionState(): LocalRouteState {
  return localRoute;
}

/** Kick off availability check + model install for on-device recognition.
 *  MUST be called from inside a user tap (install needs the gesture).
 *  Idempotent and non-blocking; safe on browsers without the API. */
export function prepareLocalRecognition(lang: string): void {
  if (localRoute !== 'unknown') return;
  // v5.6.0 — NEVER touch the WebView's SpeechRecognition statics inside the
  // Android app: the WebView exposes a hollow webkitSpeechRecognition with no
  // service behind it, and poking its available()/install() force-closes the
  // renderer — this was the "voice mode exits the app" crash. On native the
  // Capacitor plugin runs the system recognizer; there is no local web route.
  if (Capacitor.isNativePlatform()) {
    localRoute = 'no-api';
    return;
  }
  const S = recognitionCtor() as unknown as RecognitionStatics | null;
  if (!S || typeof S.available !== 'function') {
    localRoute = 'no-api';
    return;
  }
  localRoute = 'checking';
  void S.available({ langs: [lang], processLocally: true })
    .then((a) => {
      if (a === 'available') {
        localRoute = 'ready';
        return;
      }
      if (a === 'downloadable' && typeof S.install === 'function') {
        // Still inside the tap's transient-activation window (~seconds).
        localRoute = 'installing';
        return S.install({ langs: [lang], processLocally: true }).then((ok) => {
          localRoute = ok ? 'ready' : 'unavailable';
        });
      }
      localRoute = 'unavailable';
      return;
    })
    .catch(() => {
      localRoute = 'unavailable';
    });
}
