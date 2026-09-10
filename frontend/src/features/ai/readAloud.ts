import { pickSynthVoice } from '@/features/voice/pickSynthVoice';
import { splitForTts } from '@/features/voice/liveVoiceEngine';
import { isNativePlatform } from '@/services/native';

/**
 * Read a reply aloud. Markdown is flattened to plain sentences first, and one
 * reply speaks at a time.
 *
 * v5.27.0 — this used the device's own voice and nothing else, which made the
 * Settings → Voice choice a half-truth: it governed live voice chat but not
 * the Read-aloud button beside every reply. It now speaks in the chosen
 * studio voice when one is set, and falls back to the device the moment the
 * network, the key or the model lets it down. The device voice remains the
 * default and the only offline path.
 *
 * The server route caps input per request, so a long reply is spoken as a
 * queue of chunks (splitForTts is the same word-boundary splitter live voice
 * uses — one cap, one implementation). The NEXT chunk is fetched while the
 * current one plays, so the gap between chunks is inaudible.
 */
let speakingId: string | null = null;
const listeners = new Set<(id: string | null) => void>();

export function onSpeakingChange(fn: (id: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(id: string | null): void {
  speakingId = id;
  listeners.forEach((fn) => fn(id));
}

export function readAloudSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

/** Markdown → speakable text. Code blocks become a short note, tables flatten. */
export function speakableText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ', ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\$\$?[^$]+\$\$?/g, ' (formula) ')
    .replace(/^>>>.*$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, 4000);
}

/* ---------------------------------------------------------------- server voice */

const TTS_PATH = isNativePlatform() ? 'https://www.sirimillavinay.online/api/tts' : '/api/tts';
/** Per-chunk leash. Read-aloud is a deliberate tap rather than a live
 *  conversation, so it can wait a little longer than voice chat's 3.5s before
 *  giving up — but not long enough to feel broken. */
const CHUNK_LEASH_MS = 5000;

/** How the caller supplies the listener's choice. Returning null means "speak
 *  on this device", which is also the answer when no speech model is served. */
type VoiceGetter = () => { model: string; voice: string } | null;
let getVoice: VoiceGetter | null = null;

/** Wire the Settings → Voice choice in. Read fresh per chunk, so changing the
 *  voice mid-reply applies to the rest of it. */
export function setReadAloudVoice(fn: VoiceGetter | null): void {
  getVoice = fn;
}

/** Everything cancellable about the current server-voice turn. */
let audioEl: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
const inflight = new Set<AbortController>();
/** Bumped on every stop/start so a late promise from a cancelled turn can
 *  tell it is stale and refuse to touch anything. */
let turn = 0;

function releaseUrl(): void {
  if (objectUrl) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* already gone */
    }
    objectUrl = null;
  }
}

function teardownAudio(): void {
  if (audioEl) {
    try {
      audioEl.pause();
      audioEl.onended = null;
      audioEl.onerror = null;
      audioEl.src = '';
    } catch {
      /* element already detached */
    }
    audioEl = null;
  }
  releaseUrl();
}

/** One chunk's audio, or null on ANY failure — never throws. */
function fetchChunk(text: string, pick: { model: string; voice: string }): Promise<Blob | null> {
  if (typeof fetch !== 'function') return Promise.resolve(null);
  const ctrl = new AbortController();
  inflight.add(ctrl);
  const timer = window.setTimeout(() => ctrl.abort(), CHUNK_LEASH_MS);
  return fetch(TTS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, model: pick.model, voice: pick.voice }),
    signal: ctrl.signal,
  })
    .then((res) => {
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('audio/')) return null;
      return res.blob().then((b) => (b.size > 0 ? b : null));
    })
    .catch(() => null)
    .finally(() => {
      window.clearTimeout(timer);
      inflight.delete(ctrl);
    });
}

/** Play one blob to completion. Resolves false if playback fails, so the
 *  caller can fall back rather than leaving the reply half-spoken. */
function playBlob(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      releaseUrl();
      objectUrl = URL.createObjectURL(blob);
      const el = new Audio(objectUrl);
      audioEl = el;
      el.onended = () => done(true);
      el.onerror = () => done(false);
      // Autoplay policies reject silently outside a gesture; readAloud is
      // always called from a click, but a rejection must still resolve.
      void el.play().catch(() => done(false));
    } catch {
      done(false);
    }
  });
}

/** Speak with the device's own engine. The original path, kept whole. */
function speakOnDevice(id: string, text: string): void {
  if (!readAloudSupported()) {
    if (speakingId === id) emit(null);
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  const v = pickSynthVoice('en-IN');
  if (v) u.voice = v;
  u.rate = 1.02;
  u.onend = () => { if (speakingId === id) emit(null); };
  u.onerror = () => { if (speakingId === id) emit(null); };
  window.speechSynthesis.speak(u);
}

/** Speak the whole reply in the chosen studio voice, prefetching one chunk
 *  ahead. Returns false if the FIRST chunk fails, so the caller can hand the
 *  turn to the device voice with nothing spoken twice. */
async function speakOnServer(text: string, pick: { model: string; voice: string }, mine: number): Promise<boolean> {
  const chunks = splitForTts(text);
  let next = fetchChunk(chunks[0], pick);
  for (let i = 0; i < chunks.length; i += 1) {
    const blob = await next;
    if (turn !== mine) return true; // cancelled: nothing more to do, and no fallback
    if (!blob) return i === 0 ? false : true; // mid-reply failure: stop, don't restart
    // Fetch the next chunk while this one plays, so the seam is inaudible.
    next = i + 1 < chunks.length ? fetchChunk(chunks[i + 1], pick) : Promise.resolve(null);
    const ok = await playBlob(blob);
    if (turn !== mine) return true;
    if (!ok) return i === 0 ? false : true;
  }
  return true;
}

export function stopReadAloud(): void {
  turn += 1;
  for (const c of inflight) {
    try {
      c.abort();
    } catch {
      /* already aborted */
    }
  }
  inflight.clear();
  teardownAudio();
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* no synth */
  }
  emit(null);
}

export function readAloud(id: string, md: string): void {
  // Tapping the speaking reply again stops it.
  if (speakingId === id) {
    stopReadAloud();
    return;
  }
  stopReadAloud();
  const text = speakableText(md);
  if (!text) return;
  const pick = getVoice ? getVoice() : null;
  turn += 1;
  const mine = turn;
  emit(id);
  if (!pick) {
    speakOnDevice(id, text);
    return;
  }
  void speakOnServer(text, pick, mine).then((ok) => {
    if (turn !== mine) return; // a newer turn owns the UI now
    if (ok) {
      if (speakingId === id) emit(null);
      return;
    }
    // The studio voice never started — speak it on the device instead, so a
    // failed request costs a moment, not the reply.
    speakOnDevice(id, text);
  });
}
