/** Unified speech-to-text (STT) sessions — one interface, two engines.
 *
 *  WEB — the Web Speech API (SpeechRecognition / webkitSpeechRecognition),
 *  exactly the hardened path live voice and dictation always used, including
 *  the Chrome 139+ on-device route (processLocally).
 *
 *  NATIVE (the Android app) — the system speech recognizer via the Capacitor
 *  SpeechRecognition plugin. The WebView exposes a webkitSpeechRecognition
 *  shell with NO service behind it (starting it force-closes the renderer —
 *  the original reason voice was hidden in the app), so on native the web
 *  ctor is never constructed: the platform check dispatches first.
 *
 *  Session semantics (shared by every consumer — live voice, dictation,
 *  voice search):
 *  - createSttSession() starts listening IMMEDIATELY, inside the caller's
 *    tap — no pre-flight awaits. On native the permission prompt (first run
 *    only) is part of that same tap-initiated chain.
 *  - onInterim streams the rolling transcript; onEnd fires exactly once with
 *    the final transcript ('' when nothing was heard) and a fatal reason when
 *    the session died hard (mic denied / no service).
 *  - stop() asks for a graceful end (finals still delivered); abort() tears
 *    down silently — no further callbacks.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type SttFatal = 'denied' | 'error';

export interface SttSessionOptions {
  lang: string;
  /** Web only (Chrome 139+): run recognition on-device. */
  processLocally?: boolean;
}

export interface SttSessionCallbacks {
  /** The audio pipe opened — the mic is actually hot. */
  onAudioStart?(): void;
  /** Rolling transcript: accumulated finals + the current interim guess. */
  onInterim?(text: string): void;
  /** Raw engine error string (informational — onEnd still decides the outcome). */
  onError?(raw: string): void;
  /** Fires exactly once: the session is over. */
  onEnd(finalText: string, fatal: SttFatal | null): void;
}

export interface SttSession {
  /** Graceful stop — any final transcript still arrives via onEnd. */
  stop(): void;
  /** Hard teardown — no further callbacks fire. */
  abort(): void;
}

// ---------- web engine ----------

interface WebRecResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface WebRecEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: WebRecResultLike };
}
export interface WebRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  /** Chrome 139+: run recognition on-device (no vendor speech servers). */
  processLocally?: boolean;
  onresult: ((e: WebRecEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type WebRecognitionCtor = new () => WebRecognitionLike;

/** The browser's SpeechRecognition constructor, when one exists. */
export function recognitionCtor(): WebRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: WebRecognitionCtor; webkitSpeechRecognition?: WebRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function createWebSession(opts: SttSessionOptions, cbs: SttSessionCallbacks): SttSession | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  let rec: WebRecognitionLike;
  try {
    rec = new Ctor();
  } catch {
    return null;
  }
  rec.lang = opts.lang;
  rec.continuous = false;
  rec.interimResults = true;
  if (opts.processLocally) rec.processLocally = true;
  let finalText = '';
  let fatal: SttFatal | null = null;
  let done = false;
  rec.onaudiostart = () => {
    if (!done) cbs.onAudioStart?.();
  };
  rec.onresult = (e) => {
    if (done) return;
    let interim = '';
    for (let k = e.resultIndex; k < e.results.length; k += 1) {
      const r = e.results[k];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    cbs.onInterim?.(finalText || interim);
  };
  rec.onerror = (e) => {
    if (done) return;
    const kind = e?.error ?? '';
    cbs.onError?.(kind);
    if (kind === 'not-allowed' || kind === 'service-not-allowed') fatal = 'denied';
    else if (kind === 'audio-capture') fatal = 'error';
  };
  rec.onend = () => {
    if (done) return;
    done = true;
    cbs.onEnd(finalText.trim(), fatal);
  };
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop() {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
    abort() {
      done = true;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}

// ---------- native engine (Capacitor plugin, Android system recognizer) ----------

interface NativeSttPlugin {
  available(): Promise<{ available: boolean }>;
  start(options?: {
    language?: string;
    maxResults?: number;
    partialResults?: boolean;
    popup?: boolean;
  }): Promise<{ matches?: string[] } | void>;
  stop(): Promise<void>;
  requestPermissions(): Promise<{ speechRecognition?: string }>;
  addListener(
    eventName: 'partialResults',
    fn: (data: { matches?: string[] }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'listeningState',
    fn: (data: { status?: 'started' | 'stopped' }) => void,
  ): Promise<PluginListenerHandle>;
}

/** Thin typed handle — the plugin's JS wrapper isn't imported (registerPlugin
 *  binds straight to the native side the app compiles in via cap sync), so
 *  the web bundle carries zero extra plugin code. */
const NativeStt = registerPlugin<NativeSttPlugin>('SpeechRecognition');

/** Grace after end-of-speech / manual stop: Android delivers the FINAL
 *  combined transcript as one last partialResults event that can land right
 *  after the 'stopped' state — ending instantly would drop it. */
const NATIVE_FINAL_GRACE_MS = 450;
/** Safety leash: in partial-results mode the plugin surfaces NO error events
 *  (the started call is already resolved), so a recognizer that dies silently
 *  would otherwise listen forever. Resets on every partial result. */
const NATIVE_IDLE_MS = 12_000;

function createNativeSession(opts: SttSessionOptions, cbs: SttSessionCallbacks): SttSession {
  let finished = false;
  let aborted = false;
  let lastText = '';
  let sawAudio = false;
  let idleTimer = 0;
  let graceTimer = 0;
  const handles: Array<Promise<PluginListenerHandle>> = [];
  const cleanup = (): void => {
    if (idleTimer) window.clearTimeout(idleTimer);
    if (graceTimer) window.clearTimeout(graceTimer);
    idleTimer = 0;
    graceTimer = 0;
    for (const h of handles) void h.then((x) => x.remove()).catch(() => undefined);
  };
  const end = (fatal: SttFatal | null): void => {
    if (finished) return;
    finished = true;
    cleanup();
    if (!aborted) cbs.onEnd(lastText.trim(), fatal);
  };
  const armIdle = (): void => {
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      void NativeStt.stop().catch(() => undefined);
      end(null);
    }, NATIVE_IDLE_MS);
  };
  const endSoon = (): void => {
    // Wait one beat for the final combined transcript before closing.
    if (graceTimer || finished) return;
    graceTimer = window.setTimeout(() => end(null), NATIVE_FINAL_GRACE_MS);
  };
  handles.push(
    NativeStt.addListener('partialResults', (d) => {
      if (finished) return;
      const t = Array.isArray(d?.matches) && typeof d.matches[0] === 'string' ? d.matches[0] : '';
      if (!t) return;
      lastText = t;
      if (!sawAudio) {
        sawAudio = true;
        cbs.onAudioStart?.();
      }
      armIdle();
      cbs.onInterim?.(t);
    }),
  );
  handles.push(
    NativeStt.addListener('listeningState', (d) => {
      if (finished) return;
      if (d?.status === 'started') {
        if (!sawAudio) {
          sawAudio = true;
          cbs.onAudioStart?.();
        }
      } else if (d?.status === 'stopped') {
        endSoon();
      }
    }),
  );
  armIdle();
  // Permission → start, chained from THIS tap (the system permission dialog,
  // first run only, is itself a direct product of the user's gesture).
  void NativeStt.requestPermissions()
    .then((p) => {
      if (finished) return undefined;
      if ((p?.speechRecognition ?? '') !== 'granted') {
        cbs.onError?.('not-allowed');
        end('denied');
        return undefined;
      }
      return NativeStt.start({ language: opts.lang, maxResults: 3, partialResults: true, popup: false }).then((r) => {
        // partialResults mode resolves immediately; a resolved matches array
        // (other platforms) is a final result.
        const m = r && Array.isArray(r.matches) ? r.matches : null;
        if (m && typeof m[0] === 'string' && m[0]) {
          lastText = m[0];
          end(null);
        }
      });
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      cbs.onError?.(msg);
      end(/denied|permission|not.?allowed/i.test(msg) ? 'denied' : 'error');
    });
  return {
    stop() {
      void NativeStt.stop().catch(() => undefined);
      endSoon();
    },
    abort() {
      aborted = true;
      void NativeStt.stop().catch(() => undefined);
      end(null);
    },
  };
}

// ---------- unified surface ----------

const isNative = (): boolean => Capacitor.isNativePlatform();

/** Cached device-level answer from the native plugin's available() probe. */
let nativeAvailable: boolean | null = null;

/** Best-known-now support answer, synchronous (render gates).
 *  Native: the compiled-in plugin, minus a negative available() probe.
 *  Web: a real SpeechRecognition constructor. */
export function sttSupported(): boolean {
  if (isNative()) return nativeAvailable !== false && Capacitor.isPluginAvailable('SpeechRecognition');
  return recognitionCtor() !== null;
}

/** Resolve the definitive support answer (native: asks the device whether a
 *  recognition service exists). Cached; safe to call from an effect. */
export async function probeSttSupport(): Promise<boolean> {
  if (!isNative()) return recognitionCtor() !== null;
  if (!Capacitor.isPluginAvailable('SpeechRecognition')) return false;
  if (nativeAvailable !== null) return nativeAvailable;
  try {
    const r = await NativeStt.available();
    nativeAvailable = r?.available !== false;
  } catch {
    nativeAvailable = false;
  }
  return nativeAvailable;
}

/** Test seam: reset the cached native probe. */
export function resetSttProbeForTests(): void {
  nativeAvailable = null;
}

/** Start listening NOW (inside the caller's tap). Returns null when no
 *  engine can start here — callers show their honest unsupported message. */
export function createSttSession(opts: SttSessionOptions, cbs: SttSessionCallbacks): SttSession | null {
  if (isNative()) {
    if (!Capacitor.isPluginAvailable('SpeechRecognition') || nativeAvailable === false) return null;
    return createNativeSession(opts, cbs);
  }
  return createWebSession(opts, cbs);
}
