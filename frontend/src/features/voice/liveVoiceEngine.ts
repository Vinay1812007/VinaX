/** Live two-way voice engine for VinaX AI — Web Speech in, server voice out
 *  (with the browser's own speech engine as a seamless fallback).
 *
 *  The loop: LISTENING (mic open, real audio levels + waveform) → final user
 *  sentence → THINKING (the page streams the reply in via feed()) → SPEAKING
 *  begins at the FIRST complete sentence instead of waiting for the whole
 *  reply — short utterances also dodge Chrome's long-utterance cutoff — →
 *  back to LISTENING automatically. interrupt() silences output instantly
 *  and reopens the mic. The mic never runs while speaking (no echo loops).
 *
 *  Speaking (since v3.1.0) is server-TTS-first: each sentence chunk is fetched
 *  from /api/tts (natural studio voice, WAV over HTTPS) and played through one
 *  reused HTMLAudioElement while the NEXT chunk prefetches in parallel. Any
 *  error, slow fetch or blocked playback flips the rest of the turn to the
 *  existing speechSynthesis path (warm female voice chain) — the listener
 *  hears a different voice at worst, never silence. The server voice needs no
 *  pitch/rate shaping; those knobs apply only to the browser fallback.
 *
 *  Production hardening:
 *  - speechSynthesis is unlocked INSIDE the user's tap (Android Chrome drops
 *    speak() calls made later without it) with a silent warm-up utterance.
 *  - A stuck utterance (Chrome's paused-queue bug) is kicked once with
 *    cancel()+resume()+respeak, then skipped — the queue can never freeze.
 *  - A missing onend can't hang the loop (duration watchdog), and resume()
 *    keep-alives run while speaking.
 *  - The AudioContext is resumed on creation and re-resumed periodically —
 *    a suspended context is why level meters silently read zero.
 *  - interrupt() invalidates the in-flight turn, so the aborted reply's
 *    finish() can't speak a cancelled answer afterwards.
 *  - A 25s thinking watchdog returns to listening if no reply ever arrives.
 */
import { cutSentences } from './sentences';
import { createSttSession, recognitionCtor, sttSupported, type SttSession } from './stt';

export type LiveVoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';
/** Fatal reasons — 'no-tts' means recognition works but the browser refused to
 *  speak the reply (a real failure mode observed live when synth is muted at
 *  the OS level or the voice list is empty on this device). */
export type LiveVoiceFatal = 'denied' | 'unsupported' | 'error' | 'no-tts';

/** Chrome 139+ statics for the on-device speech model. */
interface RecognitionStatics {
  available?(opts: { langs: string[]; processLocally?: boolean }): Promise<string>;
  install?(opts: { langs: string[]; processLocally?: boolean }): Promise<boolean>;
}

/* ---------- on-device recognition route (shared by live voice + dictation) ----------
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

export interface LiveVoiceOptions {
  lang: string;
  getVoice(): SpeechSynthesisVoice | null;
  toSpoken(md: string): string;
  /** Package B6 — barge-in: keep the mic open while the assistant is speaking
   *  and cut it off the moment the listener starts talking. Off unless the
   *  caller opts in, because it only works cleanly where the platform's echo
   *  cancellation is reliable (Android/desktop Chrome do; some WebViews don't).
   *  The onBargeInInterim guards (grace period + echo filter) contain the
   *  false-trigger risk, but a caller can flip this off in one line if a
   *  device talks over itself. */
  bargeIn?: boolean;
}

/**
 * Echo filter for barge-in. When the mic is open during TTS it also hears the
 * assistant's own voice through the speaker; that echo, transcribed, is a
 * substring of what we're currently saying. Real barge-in speech is not. So:
 * if what we heard is contained in what we're speaking (normalised to bare
 * lowercase words), treat it as our own echo and DON'T interrupt.
 * Exported pure so the state-machine tests can lock it without audio.
 */
export function isLikelyEcho(heard: string, spoken: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const h = norm(heard);
  const s = norm(spoken);
  if (!h) return true; // nothing meaningful heard → not a real barge-in
  if (!s) return false; // we're not speaking anything → can't be echo
  // Whole heard phrase sits inside what we're saying → almost certainly echo.
  if (s.includes(h)) return true;
  // Or every heard word appears in the spoken text (recognizer reordered a
  // few echoed words) → still echo.
  const spokenWords = new Set(s.split(' '));
  const heardWords = h.split(' ');
  return heardWords.every((w) => spokenWords.has(w));
}

export interface LiveVoiceCallbacks {
  onState(s: LiveVoiceState): void;
  onLevel(level: number): void;
  onUserInterim(text: string): void;
  onUserFinal(text: string): void;
  onAssistantCaption(text: string): void;
  onFatal(reason: LiveVoiceFatal): void;
  /** Transient status line (permission prompt, model download). '' clears it. */
  onNotice?(text: string): void;
}

const WAVE_BARS = 32;

/** Server voice route — POST { text }, audio/wav back (see functions/api/tts.ts). */
const SERVER_TTS_PATH = '/api/tts';
/** Per-chunk leash: fetch + full audio download. Prefetch hides this for every
 *  chunk after the first; a miss flips the turn to the browser voice. */
const SERVER_TTS_LEASH_MS = 3500;
/** The server voice takes at most 200 chars per request — split just under it
 *  at word boundaries. (Short pieces also suit the browser fallback: they
 *  dodge Chrome's long-utterance cutoff.) */
const SERVER_TTS_MAX_CHARS = 190;

/** Word-boundary splitter for the server voice's per-request character cap. */
export function splitForTts(text: string): string[] {
  if (text.length <= SERVER_TTS_MAX_CHARS) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > SERVER_TTS_MAX_CHARS) {
    const sp = rest.lastIndexOf(' ', SERVER_TTS_MAX_CHARS);
    const cut = sp > 40 ? sp : SERVER_TTS_MAX_CHARS;
    const part = rest.slice(0, cut).trim();
    if (part) out.push(part);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** One queued speech chunk — `audio` holds its prefetched server voice, when
 *  the prefetch has started. */
interface QueueItem {
  text: string;
  audio?: Promise<Blob | null>;
}

export class LiveVoiceEngine {
  /** Live waveform bins (0–255) — the overlay renders these every frame. */
  readonly waveBins = new Uint8Array(WAVE_BARS);

  private state: LiveVoiceState = 'idle';
  private muted = false;
  private destroyed = false;
  private stt: SttSession | null = null;
  /** Session generation — callbacks from a superseded session are ignored. */
  private sttSeq = 0;
  private restartTimer = 0;
  private noResultTimer = 0;
  private retries = 0;
  // Dead-server-route detection: recognizers that END instantly with no audio
  // and no error are the signature of a broken speech service (observed live).
  private instantEnds = 0;
  // Silent-service detection: recognizer that fires audiostart, receives audio
  // for many seconds, but never surfaces a `result` or `end`. Chrome's server
  // speech service can drop into this state and never recover.
  private silentStarts = 0;
  private useLocal = false;
  // speaking side
  private queue: QueueItem[] = [];
  private speakingNow = false;
  private utter: SpeechSynthesisUtterance | null = null;
  /** Server voice failed this turn — the browser voice finishes the turn. */
  private serverTtsDown = false;
  /** One reused element for all server-voice playback (autoplay-friendly). */
  private audioEl: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private pausedByMute = false;
  private ttsFetches = new Set<AbortController>();
  private pendingRaw = '';
  private fedAny = false;
  private finished = false;
  private interrupted = false;
  private turn = 0;
  private startTimer = 0;
  private endTimer = 0;
  private thinkTimer = 0;
  private retriedUtterance = false;
  /** Set true the moment any utterance in the current turn fires onstart.
   *  If it never does before the retry window elapses, TTS is dead here —
   *  surface a fatal instead of silently swallowing the reply. */
  private ttsStartedThisTurn = false;
  private ttsFatalFired = false;
  // Package B6 — barge-in. A dedicated recognition session that runs ONLY
  // while the assistant speaks; deliberately isolated from the main STT
  // failover machinery so it can't perturb the normal listening lifecycle.
  private bargeSession: SttSession | null = null;
  private bargeSeq = 0;
  /** The text currently being spoken — the echo filter compares against it. */
  private speakingText = '';
  /** When the current speaking chunk began — a short grace period after this
   *  suppresses barge-in so the opening of our own audio can't self-trigger. */
  private speakStartedAt = 0;
  // level meter + waveform
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Uint8Array<ArrayBuffer> | null = null;
  private freqBuf: Uint8Array<ArrayBuffer> | null = null;
  private raf = 0;
  private frame = 0;
  private smooth = 0;
  private pulse = 0;
  // Android (Chrome AND the WebView app): a parallel getUserMedia stream
  // starves the speech recognizer's microphone — one mic, two takers. Skip
  // the meter there; the wave bars ride the partial-result cadence instead
  // (an honest visual — they move exactly when words are being heard).
  private micMeterAllowed = typeof navigator === 'undefined' || !/android/i.test(navigator.userAgent);

  constructor(
    private opts: LiveVoiceOptions,
    private cbs: LiveVoiceCallbacks,
  ) {}

  start(): void {
    if (this.destroyed) return;
    if (!sttSupported()) {
      this.cbs.onFatal('unsupported');
      return;
    }
    this.unlockSynthesis();
    // Inside the tap: prepare the on-device route (model install needs the
    // gesture) — the reliable fallback when the server speech route is dead.
    prepareLocalRecognition(this.opts.lang);
    if (localRoute === 'ready') this.useLocal = true;
    this.setState('listening');
    this.raf = requestAnimationFrame(this.tick);
    // INSTANT: fire recognition NOW in the tap. Kick the mic meter in parallel
    // so waveform bars ride real audio the moment the browser grants access.
    // Chrome coalesces the two requests into ONE permission prompt.
    if (this.micMeterAllowed) void this.initLevelMeter();
    this.startRecognition();
  }

  destroy(): void {
    this.destroyed = true;
    this.turn += 1;
    this.clearRestart();
    this.clearNoResult();
    this.clearSpeakTimers();
    this.clearThink();
    this.disarmBargeIn();
    this.abortRec();
    this.queue = [];
    this.speakingNow = false;
    this.abortTtsFetches();
    this.stopAudioElement();
    this.audioEl = null;
    this.neuterUtterance();
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* no synthesis */
    }
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audioCtx?.close().catch(() => null);
    this.audioCtx = null;
    this.analyser = null;
    this.state = 'idle';
  }

  setMuted(m: boolean): void {
    this.muted = m;
    // Server voice honors mute directly: pause the audio, resume on unmute.
    const el = this.audioEl;
    if (m) {
      if (el && !el.paused) {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
        this.pausedByMute = true;
      }
    } else if (this.pausedByMute) {
      this.pausedByMute = false;
      try {
        void el?.play()?.catch(() => null);
      } catch {
        /* ignore */
      }
    }
    if (m) {
      this.clearRestart();
      this.clearNoResult();
      this.abortRec();
    } else if (this.state === 'listening') {
      this.startRecognition();
    }
  }

  /** Stream the assistant reply in as it arrives (SSE deltas). */
  feed(delta: string): void {
    if (this.destroyed || this.interrupted) return;
    this.clearThink();
    this.fedAny = true;
    this.pendingRaw += delta;
    const { sentences, rest } = cutSentences(this.pendingRaw);
    this.pendingRaw = rest;
    for (const s of sentences) this.enqueue(s);
  }

  /** Reply stream ended — flush the tail. Falls back to fullText when nothing streamed. */
  finish(fullText?: string): void {
    if (this.destroyed || this.interrupted) return;
    this.clearThink();
    if (!this.fedAny && fullText) {
      this.speakDirect(fullText);
      return;
    }
    this.finished = true;
    const tail = this.pendingRaw.trim();
    this.pendingRaw = '';
    if (tail) this.enqueue(tail);
    else if (!this.speakingNow && this.queue.length === 0) this.turnDone();
  }

  /** Instant one-liner (music-command confirmations). */
  speakDirect(line: string): void {
    if (this.destroyed) return;
    this.clearThink();
    this.finished = true;
    this.enqueue(line);
  }

  /** The reply was cancelled or empty — go straight back to listening. */
  cancelTurn(): void {
    if (this.destroyed) return;
    this.clearThink();
    this.queue = [];
    this.pendingRaw = '';
    this.finished = false;
    if (!this.speakingNow) this.turnDone();
  }

  /** Tap-to-interrupt: silence output now, reopen the mic. */
  interrupt(): void {
    if (this.destroyed) return;
    this.turn += 1;
    this.interrupted = true;
    this.clearThink();
    this.clearSpeakTimers();
    this.queue = [];
    this.pendingRaw = '';
    this.finished = false;
    this.speakingNow = false;
    this.abortTtsFetches();
    this.stopAudioElement();
    this.neuterUtterance();
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* no synthesis */
    }
    this.turnDone();
  }

  /** Package B6 — barge-in / manual pause: stop speaking THIS INSTANT and hand
   *  the floor back to the listener. Public so the overlay can bind it to a
   *  gesture; the barge-in detector also calls it when the listener starts
   *  talking over the reply. No-op unless we're actually speaking. Reuses the
   *  battle-tested interrupt() path, which cancels TTS and reopens the mic. */
  pauseSpeaking(): void {
    if (this.destroyed || this.state !== 'speaking') return;
    this.interrupt();
  }

  // ---------- barge-in ----------

  /** Start a short-lived recognition session for the duration of a speaking
   *  chunk. Isolated from the main STT lifecycle (its own seq + session ref)
   *  so its callbacks can never be confused with a real listening turn. */
  private armBargeIn(): void {
    if (this.destroyed || !this.opts.bargeIn || this.bargeSession) return;
    if (typeof recognitionCtor === 'undefined' && !sttSupported()) return;
    this.speakStartedAt = Date.now();
    const seq = ++this.bargeSeq;
    try {
      this.bargeSession = createSttSession(
        { lang: this.opts.lang, processLocally: this.useLocal },
        {
          onInterim: (t) => {
            if (this.destroyed || seq !== this.bargeSeq) return;
            this.onBargeInInterim(t);
          },
          onEnd: () => {
            if (seq !== this.bargeSeq) return;
            this.bargeSession = null;
            // Re-arm if we're still speaking — recognizers end their own
            // sessions periodically; keep an ear open until the chunk finishes.
            if (!this.destroyed && this.state === 'speaking' && this.opts.bargeIn) {
              window.setTimeout(() => {
                if (!this.destroyed && this.state === 'speaking') this.armBargeIn();
              }, 120);
            }
          },
        },
      );
    } catch {
      this.bargeSession = null;
    }
  }

  private disarmBargeIn(): void {
    this.bargeSeq += 1; // invalidate any in-flight callbacks
    const s = this.bargeSession;
    this.bargeSession = null;
    try {
      s?.abort();
    } catch {
      /* already gone */
    }
  }

  private onBargeInInterim(text: string): void {
    if (this.state !== 'speaking') return;
    // Grace period: ignore the first stretch of a chunk so the opening of our
    // own audio can't self-trigger before the echo filter has real words.
    if (Date.now() - this.speakStartedAt < 700) return;
    const heard = text.trim();
    if (heard.replace(/[^a-z0-9]/gi, '').length < 3) return; // too little to be intent
    if (isLikelyEcho(heard, this.speakingText)) return; // our own voice echoing back
    // Real speech over the reply — yield the floor. interrupt() reopens the
    // mic, and the fresh listening session captures the user's full utterance.
    this.pauseSpeaking();
  }

  // ---------- internals ----------

  /** Must run inside the user's tap. Chrome — a hard rule on Android — drops
   *  speak() calls that arrive later unless synthesis was used in a gesture. */
  private unlockSynthesis(): void {
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      synth.resume();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.rate = 2;
      synth.speak(u);
    } catch {
      /* no synthesis — captions still work */
    }
  }

  private neuterUtterance(): void {
    if (this.utter) {
      this.utter.onend = null;
      this.utter.onerror = null;
      this.utter.onstart = null;
      this.utter = null;
    }
  }

  private setState(s: LiveVoiceState): void {
    if (this.destroyed || this.state === s) return;
    // Package B6 — tear the barge-in ear down the instant we stop speaking, so
    // it can never leak into a listening/thinking turn.
    if (s !== 'speaking' && this.bargeSession) this.disarmBargeIn();
    this.state = s;
    this.cbs.onState(s);
  }

  // ---------- listening ----------
  private abortRec(): void {
    this.sttSeq += 1;
    this.stt?.abort();
    this.stt = null;
  }

  private clearRestart(): void {
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    this.restartTimer = 0;
  }

  private clearNoResult(): void {
    if (this.noResultTimer) window.clearTimeout(this.noResultTimer);
    this.noResultTimer = 0;
  }

  private startRecognition(): void {
    if (this.destroyed || this.muted || this.state !== 'listening') return;
    this.abortRec();
    // Prefer the on-device route once its model is ready — it keeps working
    // when the server speech route silently dies (and is private + offline).
    // (Web only: on native the plugin runs the system recognizer directly.)
    if (localRoute === 'ready') this.useLocal = true;
    const seq = this.sttSeq;
    const startedAt = Date.now();
    let sawAudio = false;
    let sawResult = false;
    const session = createSttSession(
      { lang: this.opts.lang, processLocally: this.useLocal },
      {
        onAudioStart: () => {
          if (this.destroyed || seq !== this.sttSeq) return;
          sawAudio = true;
          this.cbs.onNotice?.('');
        },
        onInterim: (t) => {
          if (this.destroyed || seq !== this.sttSeq) return;
          // A real result proves the pipe works — clear the silent-service
          // watchdog and reset the failover counters.
          sawResult = true;
          this.retries = 0;
          this.instantEnds = 0;
          this.silentStarts = 0;
          this.clearNoResult();
          if (!this.analyser) this.pulse = Math.min(0.8, this.pulse + 0.35);
          this.cbs.onUserInterim(t);
        },
        onError: (raw) => {
          if (raw === 'language-not-supported' && this.useLocal) {
            // The on-device model can't do this language — drop back to the
            // server route for the next session.
            this.useLocal = false;
          }
        },
        onEnd: (finalText, fatal) => {
          if (this.destroyed || seq !== this.sttSeq) return;
          this.stt = null;
          this.clearNoResult();
          if (fatal) {
            this.cbs.onFatal(fatal);
            return;
          }
          const said = finalText.trim();
          if (said) {
            this.beginTurn();
            this.cbs.onUserFinal(said);
            return;
          }
          if (this.muted || this.state !== 'listening') return;
          // Dead speech service: ended instantly, mic never opened, no error.
          const instant = !sawAudio && Date.now() - startedAt < 1500;
          this.instantEnds = instant ? this.instantEnds + 1 : 0;
          if (instant && this.instantEnds >= 2 && !this.useLocal && localRoute === 'ready') {
            this.instantEnds = 0; // switch to the working on-device route
            this.useLocal = true;
          } else if (instant && this.instantEnds >= 6 && localRoute !== 'installing' && localRoute !== 'checking') {
            // No working route at all — say so instead of listening forever.
            this.cbs.onFatal('error');
            return;
          }
          if (localRoute === 'installing') this.cbs.onNotice?.('Preparing voice — downloading the speech model…');
          // Heard nothing — keep the loop alive with a gentle backoff.
          this.retries = Math.min(this.retries + 1, 6);
          this.clearRestart();
          this.restartTimer = window.setTimeout(() => this.startRecognition(), 250 * this.retries);
        },
      },
    );
    if (!session) {
      // Support was verified at start(); a session that can't even construct
      // here is a hard engine failure, not an unsupported browser.
      this.cbs.onFatal(sttSupported() ? 'error' : 'unsupported');
      return;
    }
    this.stt = session;
    // Silent-service watchdog: the session accepted start and audio began
    // flowing but no result and no end for 8 seconds. Chrome's server speech
    // route can enter this state and never recover — force-restart so the mic
    // isn't stuck listening to a dead pipe. After 3 in a row with no result
    // at all, fall over honestly.
    this.clearNoResult();
    this.noResultTimer = window.setTimeout(() => {
      if (this.destroyed || seq !== this.sttSeq || this.stt !== session) return;
      if (sawResult || !sawAudio) return; // result flowed / no-audio path is onEnd's
      this.silentStarts += 1;
      this.abortRec();
      if (this.silentStarts >= 3 && !this.useLocal && localRoute === 'ready') {
        this.silentStarts = 0;
        this.useLocal = true;
      } else if (this.silentStarts >= 4 && localRoute !== 'installing' && localRoute !== 'checking') {
        this.cbs.onFatal('error');
        return;
      }
      // The old web path restarted via abort()→onend; sessions abort silently,
      // so the watchdog restarts the loop itself.
      this.clearRestart();
      this.restartTimer = window.setTimeout(() => this.startRecognition(), 300);
    }, 8000);
  }

  private clearThink(): void {
    if (this.thinkTimer) window.clearTimeout(this.thinkTimer);
    this.thinkTimer = 0;
  }

  private beginTurn(): void {
    this.turn += 1;
    this.interrupted = false;
    this.queue = [];
    this.pendingRaw = '';
    this.fedAny = false;
    this.finished = false;
    this.ttsStartedThisTurn = false;
    this.ttsFatalFired = false;
    // Fresh turn, fresh chance for the server voice after a blip.
    this.serverTtsDown = false;
    this.pausedByMute = false;
    this.clearRestart();
    this.clearThink();
    this.setState('thinking');
    // If no reply ever arrives, return to listening instead of hanging.
    this.thinkTimer = window.setTimeout(() => {
      if (!this.destroyed && this.state === 'thinking' && !this.fedAny) this.cancelTurn();
    }, 25_000);
  }

  private turnDone(): void {
    if (this.destroyed) return;
    this.finished = false;
    this.setState('listening');
    this.clearRestart();
    // Small gap so the mic never catches the tail of our own audio.
    this.restartTimer = window.setTimeout(() => this.startRecognition(), 300);
  }

  /** Fire 'no-tts' once per turn if TTS never started — dead speak() means
   *  the user hears nothing at all, so tell them plainly instead of hiding it. */
  private maybeFireTtsFatal(): void {
    if (this.destroyed || this.ttsFatalFired || this.ttsStartedThisTurn) return;
    this.ttsFatalFired = true;
    this.cbs.onFatal('no-tts');
  }

  // ---------- speaking ----------
  private clearSpeakTimers(): void {
    if (this.startTimer) window.clearTimeout(this.startTimer);
    if (this.endTimer) window.clearTimeout(this.endTimer);
    this.startTimer = 0;
    this.endTimer = 0;
  }

  private enqueue(raw: string): void {
    const text = this.opts.toSpoken(raw).trim();
    if (!text) {
      if (this.finished && !this.speakingNow && this.queue.length === 0) this.turnDone();
      return;
    }
    for (const piece of splitForTts(text)) this.queue.push({ text: piece });
    this.speakNext();
  }

  private speakNext(): void {
    if (this.destroyed || this.speakingNow) return;
    const item = this.queue.shift();
    if (item === undefined) {
      if (this.finished) this.turnDone();
      return;
    }
    this.setState('speaking');
    this.speakingNow = true;
    // Package B6 — remember what we're saying (echo filter) and open the
    // barge-in ear for this chunk. No-op unless opts.bargeIn is set.
    this.speakingText = item.text;
    this.armBargeIn();
    const token = this.turn;
    if (!this.serverTtsDown) {
      const fetched = item.audio ?? this.fetchServerTts(item.text);
      // Prefetch the NEXT chunk while this one downloads/plays — back-to-back
      // sentences then flow with no fetch gap between them.
      const next = this.queue[0];
      if (next && !next.audio) next.audio = this.fetchServerTts(next.text);
      void fetched.then((blob) => {
        if (token !== this.turn || this.destroyed) return;
        if (blob) {
          this.playServerAudio(item.text, blob, token);
          return;
        }
        // Server voice failed — the browser voice finishes this turn.
        this.serverTtsDown = true;
        this.speakSynth(item.text, token);
      });
      return;
    }
    this.speakSynth(item.text, token);
  }

  // ----- server voice path -----

  /** Fetch one chunk's audio from the server voice. Resolves null on ANY
   *  failure (error, non-audio reply, empty body, leash) — never throws. */
  private fetchServerTts(text: string): Promise<Blob | null> {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    const ctrl = new AbortController();
    this.ttsFetches.add(ctrl);
    const timer = window.setTimeout(() => ctrl.abort(), SERVER_TTS_LEASH_MS);
    let req: Promise<Response>;
    try {
      req = fetch(SERVER_TTS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
      });
    } catch {
      window.clearTimeout(timer);
      this.ttsFetches.delete(ctrl);
      return Promise.resolve(null);
    }
    return req
      .then((res) => {
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('audio/')) return null;
        return res.blob().then((b) => (b.size > 0 ? b : null));
      })
      .catch(() => null)
      .finally(() => {
        window.clearTimeout(timer);
        this.ttsFetches.delete(ctrl);
      });
  }

  private abortTtsFetches(): void {
    for (const ctrl of this.ttsFetches) ctrl.abort();
    this.ttsFetches.clear();
  }

  private releaseAudioUrl(): void {
    if (this.audioUrl) {
      try {
        URL.revokeObjectURL(this.audioUrl);
      } catch {
        /* ignore */
      }
      this.audioUrl = null;
    }
  }

  /** Stop server-voice playback and detach handlers (element is reused). */
  private stopAudioElement(): void {
    const el = this.audioEl;
    if (el) {
      el.onplaying = null;
      el.onended = null;
      el.onerror = null;
      el.ontimeupdate = null;
      try {
        el.pause();
      } catch {
        /* ignore */
      }
      try {
        el.removeAttribute('src');
        el.load();
      } catch {
        /* ignore */
      }
    }
    this.releaseAudioUrl();
  }

  private playServerAudio(text: string, blob: Blob, token: number): void {
    let el = this.audioEl;
    if (!el) {
      try {
        el = new Audio();
        el.preload = 'auto';
      } catch {
        el = null;
      }
      this.audioEl = el;
    }
    if (!el || typeof URL.createObjectURL !== 'function') {
      this.serverTtsDown = true;
      this.speakSynth(text, token);
      return;
    }
    this.releaseAudioUrl();
    const url = URL.createObjectURL(blob);
    this.audioUrl = url;
    let started = false;
    let fellBack = false;
    const advance = (): void => {
      if (fellBack) return;
      this.clearSpeakTimers();
      if (token !== this.turn || this.destroyed) return;
      this.releaseAudioUrl();
      this.speakingNow = false;
      this.speakNext();
    };
    // Playback never began → the browser voice takes over for this chunk and
    // the rest of the turn (autoplay block, decode failure, dead element).
    const fallBack = (): void => {
      if (fellBack || started || token !== this.turn || this.destroyed) return;
      fellBack = true;
      this.serverTtsDown = true;
      this.clearSpeakTimers();
      this.stopAudioElement();
      this.speakSynth(text, token);
    };
    el.onplaying = () => {
      started = true;
      this.ttsStartedThisTurn = true;
      if (this.startTimer) {
        window.clearTimeout(this.startTimer);
        this.startTimer = 0;
      }
      if (token === this.turn && !this.destroyed) this.cbs.onAssistantCaption(text);
    };
    el.ontimeupdate = () => {
      this.pulse = Math.min(0.8, this.pulse + 0.3);
    };
    el.onended = advance;
    el.onerror = () => {
      if (started) advance();
      else fallBack();
    };
    this.clearSpeakTimers();
    // Watchdog 1: audio never starts. Watchdog 2: onended never fires.
    this.startTimer = window.setTimeout(fallBack, 3000);
    this.endTimer = window.setTimeout(advance, 5000 + text.length * 90);
    el.src = url;
    let p: Promise<void> | undefined;
    try {
      p = el.play();
    } catch {
      fallBack();
      return;
    }
    if (p && typeof p.catch === 'function') void p.catch(() => fallBack());
  }

  // ----- browser voice path (fallback) -----

  private speakSynth(text: string, token: number): void {
    if (token !== this.turn || this.destroyed) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.queue = [];
      this.speakingNow = false;
      this.turnDone();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const v = this.opts.getVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    // Brighter, bubblier character: a touch higher pitch and slightly quicker
    // pace reads as warm-female-upbeat across engines. Volume stays default.
    u.pitch = 1.15;
    u.rate = 1.06;
    let started = false;
    const advance = (): void => {
      this.clearSpeakTimers();
      if (token !== this.turn || this.destroyed) return;
      this.retriedUtterance = false;
      this.speakingNow = false;
      this.utter = null;
      this.speakNext();
    };
    u.onstart = () => {
      started = true;
      this.ttsStartedThisTurn = true;
      if (this.startTimer) {
        window.clearTimeout(this.startTimer);
        this.startTimer = 0;
      }
      if (token === this.turn && !this.destroyed) this.cbs.onAssistantCaption(text);
    };
    u.onboundary = () => {
      this.pulse = Math.min(0.8, this.pulse + 0.45);
    };
    u.onend = advance;
    u.onerror = () => {
      // A synth-side error before onstart is a dead-TTS signal too — surface
      // it plainly instead of silently swallowing the reply.
      this.maybeFireTtsFatal();
      advance();
    };
    this.utter = u; // keep a reference — Chrome GCs utterances and drops onend otherwise
    this.speakingNow = true;
    this.clearSpeakTimers();
    // Watchdog 1: utterance never starts (Chrome's stuck paused queue) —
    // kick it once with cancel()+resume()+respeak, then skip the sentence.
    // If the FIRST utterance of a turn never starts even after the retry,
    // TTS is dead here: surface a fatal so the user is told plainly instead
    // of hearing silence forever (owner report: 'AI never replies').
    this.startTimer = window.setTimeout(() => {
      if (started || token !== this.turn || this.destroyed) return;
      if (!this.retriedUtterance) {
        this.retriedUtterance = true;
        try {
          window.speechSynthesis.cancel();
          window.speechSynthesis.resume();
          window.speechSynthesis.speak(u);
        } catch {
          this.maybeFireTtsFatal();
          advance();
          return;
        }
        this.startTimer = window.setTimeout(() => {
          if (started) return;
          this.maybeFireTtsFatal();
          advance();
        }, 2500);
      } else {
        this.maybeFireTtsFatal();
        advance();
      }
    }, 2500);
    // Watchdog 2: onend never fires — force the queue forward. If the
    // utterance never even STARTED, TTS is dead here: fire the no-tts fatal
    // so the user is told plainly instead of hearing endless silence.
    this.endTimer = window.setTimeout(() => {
      if (!started) this.maybeFireTtsFatal();
      advance();
    }, 4000 + text.length * 90);
    try {
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(u);
    } catch {
      advance();
    }
  }

  // ---------- level meter + waveform ----------
  private async initLevelMeter(): Promise<void> {
    try {
      if (!this.micMeterAllowed) return;
      if (!navigator.mediaDevices?.getUserMedia) return;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (err) {
        // A hard denial must surface — recognition also runs and will emit
        // its own 'not-allowed'; whichever races through first wins.
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          if (!this.destroyed) this.cbs.onFatal('denied');
        }
        return;
      }
      if (this.destroyed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const Ctx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = new Ctx();
      // A fresh AudioContext can start 'suspended' — that reads as silence.
      if (ctx.state === 'suspended') void ctx.resume().catch(() => null);
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      src.connect(analyser);
      this.stream = stream;
      this.audioCtx = ctx;
      this.analyser = analyser;
      this.levelBuf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      this.freqBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch {
      /* the meter is progressive enhancement — waves fall back to procedural */
    }
  }

  private smoothBin(i: number, target: number): void {
    const prev = this.waveBins[i];
    this.waveBins[i] = prev + (target - prev) * (target > prev ? 0.5 : 0.18);
  }

  private tick = (): void => {
    if (this.destroyed) return;
    this.frame += 1;
    if (this.frame % 180 === 0 && this.audioCtx?.state === 'suspended') {
      void this.audioCtx.resume().catch(() => null);
    }
    if (this.speakingNow && this.frame % 240 === 0) {
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
    }
    const an = this.analyser;
    const lb = this.levelBuf;
    const fb = this.freqBuf;
    const t = performance.now() / 1000;
    let target = 0;
    if (this.state === 'listening' && !this.muted && an && lb && fb) {
      // Real microphone data: RMS for the orb, spectrum for the wave bars.
      an.getByteTimeDomainData(lb);
      let sum = 0;
      for (let i = 0; i < lb.length; i += 1) {
        const d = (lb[i] - 128) / 128;
        sum += d * d;
      }
      target = Math.min(1, Math.sqrt(sum / lb.length) * 4);
      an.getByteFrequencyData(fb);
      const span = Math.min(128, fb.length); // voice lives in the lower bins
      const group = Math.max(1, Math.floor(span / WAVE_BARS));
      for (let i = 0; i < WAVE_BARS; i += 1) {
        let mx = 0;
        for (let k = i * group; k < i * group + group && k < span; k += 1) mx = Math.max(mx, fb[k]);
        this.smoothBin(i, mx);
      }
    } else {
      // Procedural waves: pulse-driven while speaking, gentle while thinking.
      let base = 0.05;
      let amp = 0.06;
      let speed = 1.6;
      if (this.state === 'speaking') {
        this.pulse *= 0.92;
        base = 0.1 + this.pulse * 0.45;
        amp = 0.18 + this.pulse * 0.5;
        speed = 7;
        target = 0.18 + this.pulse;
      } else if (this.state === 'thinking') {
        base = 0.08;
        amp = 0.1;
        speed = 2.2;
        target = 0.12;
      } else if (this.muted) {
        base = 0.02;
        amp = 0.02;
        speed = 1.2;
      } else if (this.state === 'listening') {
        // No analyser here (Android web) — waves follow speech activity.
        this.pulse *= 0.9;
        base = 0.06 + this.pulse * 0.4;
        amp = 0.1 + this.pulse * 0.5;
        speed = 5;
        target = 0.1 + this.pulse;
      }
      for (let i = 0; i < WAVE_BARS; i += 1) {
        const v = 255 * (base + amp * (0.5 + 0.5 * Math.sin(t * speed + i * 0.55)));
        this.smoothBin(i, v);
      }
    }
    this.smooth += (target - this.smooth) * (target > this.smooth ? 0.35 : 0.1);
    this.cbs.onLevel(this.smooth);
    this.raf = requestAnimationFrame(this.tick);
  };
}
