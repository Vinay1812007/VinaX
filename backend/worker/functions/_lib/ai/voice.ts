/**
 * VinaX AI — voice (phase 6): speech to text for dictation, text to speech
 * for Read aloud, and the short-lived tokens Live voice connects with.
 * Provider details were checked against the providers' docs on 2026-10-31
 * (docs/ai.md, "Voice"):
 *
 *   Dictation   Groq whisper-large-v3-turbo → whisper-large-v3 → Gemini
 *               gemini-3.5-transcribe → gemini-3.8-flash (the audio reaches
 *               Gemini through its Files API, so the Worker never base64s it).
 *   Read aloud  Groq Orpheus (English, or Arabic for Arabic text; 200
 *               characters a request, WAV) → Gemini TTS (3.8 Flash, 3.8
 *               Flash-Lite, 2.5 Flash preview).
 *   Live        Gemini Live over a WebSocket from the browser, with a
 *               one-use token from POST /v1beta/auth_tokens (never the key).
 *
 * Upstream error bodies are read only to classify them. Failures rest the
 * model for a while (the same rules as chat models, ./cooldown.ts restFor).
 */
import { classifyHttp, errorText, ProviderError, asProviderError } from './errors';
import { restFor } from './cooldown';
import type { AiEnv } from './types';

const GROQ = 'https://api.groq.com/openai/v1';
const GEMINI = 'https://generativelanguage.googleapis.com';

// ---------- models and voices ----------

export const STT_GROQ_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'] as const;
export const STT_GEMINI_MODELS = ['gemini-3.5-transcribe', 'gemini-3.8-flash'] as const;

export const TTS_ENGLISH = 'canopylabs/orpheus-v1-english';
export const TTS_ARABIC = 'canopylabs/orpheus-arabic-saudi';
export const TTS_GEMINI_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-2.5-flash-preview-tts'] as const;

/** Orpheus English voices (Groq's list); Troy is the default. */
export const READ_VOICES = ['troy', 'autumn', 'diana', 'hannah', 'austin', 'daniel'] as const;
export const DEFAULT_READ_VOICE = 'troy';
/** Arabic text is read by Orpheus Arabic's default voice. */
export const ARABIC_VOICE = 'abdullah';

/** Gemini's prebuilt voices offered for Live (and for Read aloud when Gemini reads). */
export const LIVE_VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda', 'Orus', 'Zephyr', 'Sulafat', 'Achird'] as const;
export const DEFAULT_LIVE_VOICE = 'Kore';

/** Live models in order; Extended thinking puts the thinking one first. */
export const LIVE_MODELS = [
  { id: 'gemini-3.8-live', name: 'Gemini 3.8 Live' },
  { id: 'gemini-3.1-flash-live-preview', name: 'Gemini 3.1 Flash Live' },
  // Google documents this dated id; the brief's "-latest" alias is not in the docs.
  { id: 'gemini-2.5-flash-native-audio-preview-12-2025', name: 'Gemini 2.5 Flash Native Audio' },
] as const;
export const LIVE_THINKING_MODEL = { id: 'gemini-3.8-live-extended-thinking', name: 'Gemini 3.8 Live (Extended thinking)' } as const;

/** Live replies are saved with model id `gemini-live:<id>`; their label under the reply. */
export const LIVE_ID_PREFIX = 'gemini-live:';
export function liveLabel(modelId: string): { name: string; provider: string } | null {
  if (!modelId.startsWith(LIVE_ID_PREFIX)) return null;
  const id = modelId.slice(LIVE_ID_PREFIX.length);
  const m = [LIVE_THINKING_MODEL, ...LIVE_MODELS].find((x) => x.id === id);
  return m ? { name: m.name, provider: 'Google Gemini' } : null;
}

export const LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

/** Characters Orpheus takes in one request. */
export const ORPHEUS_MAX_CHARS = 200;
/** Characters per Gemini TTS request (about 40 s of speech: the first audio comes quickly). */
export const GEMINI_TTS_CHARS = 600;
/** A Read aloud at most this long starts on Orpheus; longer ones use one Gemini voice throughout. */
export const ORPHEUS_REPLY_MAX = 800;

const groqKey = (env: AiEnv): string | null => env.GROQ_API_KEY?.trim() || null;
const geminiKey = (env: AiEnv): string | null => env.GEMINI_API_KEY?.trim() || null;

export interface VoiceAvailability {
  dictation: boolean;
  readAloud: boolean;
  live: boolean;
}

export const voiceAvailability = (env: AiEnv): VoiceAvailability => ({
  dictation: !!groqKey(env) || !!geminiKey(env),
  readAloud: !!groqKey(env) || !!geminiKey(env),
  live: !!geminiKey(env),
});

// ---------- rests ----------

const rests = new Map<string, number>();

export function voiceResting(model: string, now = Date.now()): boolean {
  const until = rests.get(model) ?? 0;
  return until > now;
}

export function noteVoiceFailure(model: string, err: ProviderError, now = Date.now()): void {
  const rest = restFor(err, now);
  if (!rest) return;
  if ((rests.get(model) ?? 0) < rest.until) rests.set(model, rest.until);
}

/** Test seam. */
export function _resetVoiceRests(): void {
  rests.clear();
}

// ---------- text for speech ----------

/** Arabic text gets the Arabic voice. */
export function isMostlyArabic(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const arabic = text.match(/\p{Script=Arabic}/gu)?.length ?? 0;
  return letters > 0 && arabic / letters > 0.5;
}

/**
 * Split text into pieces of at most `max` characters, at sentence ends when
 * it can, then at commas, then at spaces (a word longer than `max` is cut).
 */
export function splitSpeech(text: string, max: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…。؟]+(?:[.!?…。؟]+["'”’)]*|$)\s*/g) ?? [clean];
  const units: string[] = [];
  for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
    if (s.length <= max) { units.push(s); continue; }
    // Too long: break at commas or semicolons, then at spaces.
    let rest = s;
    while (rest.length > max) {
      const window = rest.slice(0, max + 1);
      let at = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf('، '));
      if (at < max / 3) at = window.lastIndexOf(' ');
      if (at < max / 3) at = max - 1;
      units.push(rest.slice(0, at + 1).trim());
      rest = rest.slice(at + 1).trim();
    }
    if (rest) units.push(rest);
  }
  const out: string[] = [];
  for (const u of units) {
    const last = out[out.length - 1];
    if (last && last.length + 1 + u.length <= max) out[out.length - 1] = `${last} ${u}`;
    else out.push(u);
  }
  return out;
}

// ---------- speech (text to speech) ----------

export type SpeechAudio =
  /** A whole audio file (Orpheus: WAV). */
  | { kind: 'file'; bytes: Uint8Array; mime: string }
  /** Base64 audio as Gemini sent it (WAV, or raw 16-bit PCM when `mime` says L16). */
  | { kind: 'base64'; data: string; mime: string };

const TTS_TIMEOUT_MS = 25_000;

/** One piece of speech from Orpheus (≤ ORPHEUS_MAX_CHARS). */
export async function orpheusSpeak(env: AiEnv, model: string, voice: string, text: string, signal?: AbortSignal): Promise<SpeechAudio> {
  const key = groqKey(env);
  if (!key) throw new ProviderError('not_configured');
  const timeout = AbortSignal.timeout(TTS_TIMEOUT_MS);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const res = await fetch(`${GROQ}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: text, voice, response_format: 'wav' }),
      signal: sig,
    });
    if (!res.ok) throw classifyHttp(res.status, res.headers, await errorText(res));
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) throw new ProviderError('empty');
    return { kind: 'file', bytes, mime: 'audio/wav' };
  } catch (e) {
    throw asProviderError(e, sig);
  }
}

/**
 * Pull `inlineData` out of a Gemini reply without parsing the whole JSON
 * (the audio is megabytes of base64; string searches cost far less CPU).
 */
export function inlineAudio(body: string): { data: string; mime: string } | null {
  const key = body.search(/"data"\s*:\s*"/);
  if (key < 0) return null;
  const start = body.indexOf('"', body.indexOf(':', key)) + 1;
  const end = body.indexOf('"', start);
  if (start <= 0 || end <= start) return null;
  const mime = /"mimeType"\s*:\s*"([^"]{1,100})"/.exec(body)?.[1] ?? 'audio/wav';
  return { data: body.slice(start, end), mime };
}

/** One piece of speech from a Gemini TTS model. */
export async function geminiSpeak(env: AiEnv, model: string, voice: string, text: string, signal?: AbortSignal): Promise<SpeechAudio> {
  const key = geminiKey(env);
  if (!key) throw new ProviderError('not_configured');
  // Google's guide now names the voice `voiceConfig.voice`; older models take
  // `prebuiltVoiceConfig.voiceName`. A 400 on the first shape tries the second.
  const shapes = [{ voice }, { prebuiltVoiceConfig: { voiceName: voice } }];
  let last: ProviderError = new ProviderError('upstream');
  for (const voiceConfig of shapes) {
    const timeout = AbortSignal.timeout(TTS_TIMEOUT_MS);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const res = await fetch(`${GEMINI}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig } },
        }),
        signal: sig,
      });
      if (!res.ok) {
        last = classifyHttp(res.status, res.headers, await errorText(res));
        if (last.kind === 'bad_request') continue;
        throw last;
      }
      const audio = inlineAudio(await res.text());
      if (!audio || !audio.data) throw new ProviderError('empty');
      return { kind: 'base64', data: audio.data, mime: audio.mime };
    } catch (e) {
      throw asProviderError(e, sig);
    }
  }
  throw last;
}

/** The Read aloud plan: which engine reads, with which voice, in which pieces. */
export interface SpeechPlan {
  engine: 'orpheus' | 'gemini';
  model: string;
  voice: string;
  pieces: string[];
}

/** The Gemini TTS models that may read now, in order. */
export const geminiTtsModels = (env: AiEnv, now = Date.now()): string[] => (geminiKey(env) ? TTS_GEMINI_MODELS.filter((m) => !voiceResting(m, now)) : []);

/**
 * Choose who reads. Orpheus (the brief's voice) reads short replies; a long
 * one is read by one Gemini voice from start to end, because Orpheus takes
 * 200 characters a request and its free allowance is a few requests a
 * minute: switching voices half-way through a reply sounds broken.
 */
export function planSpeech(env: AiEnv, text: string, voices: { read: string; live: string }, now = Date.now()): SpeechPlan | null {
  const arabic = isMostlyArabic(text);
  const orpheus = arabic ? TTS_ARABIC : TTS_ENGLISH;
  const orpheusOk = !!groqKey(env) && !voiceResting(orpheus, now);
  const gemini = geminiTtsModels(env, now);
  if (orpheusOk && (text.length <= ORPHEUS_REPLY_MAX || !gemini.length)) {
    return { engine: 'orpheus', model: orpheus, voice: arabic ? ARABIC_VOICE : voices.read, pieces: splitSpeech(text, ORPHEUS_MAX_CHARS) };
  }
  if (gemini.length) return { engine: 'gemini', model: gemini[0], voice: voices.live, pieces: splitSpeech(text, GEMINI_TTS_CHARS) };
  return null;
}

// ---------- dictation (speech to text) ----------

const STT_TIMEOUT_MS = 30_000;

/** The file name Groq reads the format from. */
export function clipName(mime: string): string {
  if (mime.includes('webm')) return 'clip.webm';
  if (mime.includes('ogg') || mime.includes('opus')) return 'clip.ogg';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'clip.m4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'clip.mp3';
  if (mime.includes('wav')) return 'clip.wav';
  if (mime.includes('flac')) return 'clip.flac';
  return 'clip.webm';
}

export const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'video/webm'] as const;
/** Groq's free-tier file cap. */
export const MAX_CLIP_BYTES = 25 * 1024 * 1024;
/** Gemini reads clips up to this size (the fallback uploads the clip first). */
export const MAX_GEMINI_CLIP_BYTES = 20 * 1024 * 1024;

export async function groqTranscribe(env: AiEnv, model: string, clip: Uint8Array, mime: string): Promise<string> {
  const key = groqKey(env);
  if (!key) throw new ProviderError('not_configured');
  const form = new FormData();
  form.append('file', new Blob([clip as Uint8Array<ArrayBuffer>], { type: mime }), clipName(mime));
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const sig = AbortSignal.timeout(STT_TIMEOUT_MS);
  try {
    const res = await fetch(`${GROQ}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: sig });
    if (!res.ok) throw classifyHttp(res.status, res.headers, await errorText(res));
    const j = (await res.json().catch(() => null)) as { text?: unknown } | null;
    if (!j || typeof j.text !== 'string') throw new ProviderError('upstream');
    return j.text.trim();
  } catch (e) {
    throw asProviderError(e, sig);
  }
}

/** Upload a clip to Gemini's Files API (two requests, no base64); the file's uri. */
async function geminiUpload(key: string, clip: Uint8Array, mime: string): Promise<string> {
  const start = await fetch(`${GEMINI}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(clip.length),
      'X-Goog-Upload-Header-Content-Type': mime,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'dictation' } }),
    signal: AbortSignal.timeout(15_000),
  });
  const url = start.headers.get('x-goog-upload-url');
  if (!start.ok || !url) throw classifyHttp(start.status, start.headers, await errorText(start));
  await start.body?.cancel().catch(() => undefined);
  const done = await fetch(url, {
    method: 'POST',
    headers: { 'content-length': String(clip.length), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: clip as Uint8Array<ArrayBuffer>,
    signal: AbortSignal.timeout(STT_TIMEOUT_MS),
  });
  if (!done.ok) throw classifyHttp(done.status, done.headers, await errorText(done));
  const j = (await done.json().catch(() => null)) as { file?: { uri?: unknown } } | null;
  const uri = j?.file?.uri;
  if (typeof uri !== 'string' || !uri) throw new ProviderError('upstream');
  return uri;
}

/** The text of a Gemini generateContent reply. */
function replyText(j: unknown): string {
  const parts = (j as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }> } | null)?.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p) => typeof p.text === 'string' && p.thought !== true).map((p) => p.text as string).join('').trim();
}

const TRANSCRIBE_PROMPT = 'Transcribe this audio exactly as spoken, in the language spoken. Reply with the transcript only: no labels, no timestamps, no notes. If nothing is said, reply with nothing.';

/** Gemini's turn at a clip: the dedicated transcription model, then Flash with a prompt. One upload serves both. */
export async function geminiTranscribe(env: AiEnv, clip: Uint8Array, mime: string, models: readonly string[]): Promise<{ text: string; model: string }> {
  const key = geminiKey(env);
  if (!key) throw new ProviderError('not_configured');
  let uri: string;
  try {
    uri = await geminiUpload(key, clip, mime);
  } catch (e) {
    throw asProviderError(e);
  }
  let last: ProviderError = new ProviderError('upstream');
  for (const model of models) {
    const sig = AbortSignal.timeout(STT_TIMEOUT_MS);
    try {
      const parts: unknown[] = [{ fileData: { mimeType: mime, fileUri: uri } }];
      if (model !== 'gemini-3.5-transcribe') parts.push({ text: TRANSCRIBE_PROMPT });
      const res = await fetch(`${GEMINI}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
        signal: sig,
      });
      if (!res.ok) throw classifyHttp(res.status, res.headers, await errorText(res));
      const text = replyText(await res.json().catch(() => null));
      // An empty transcript from the dedicated model is a known hiccup: ask Flash.
      if (!text && model === 'gemini-3.5-transcribe') { last = new ProviderError('empty'); continue; }
      return { text, model };
    } catch (e) {
      last = asProviderError(e, sig);
      noteVoiceFailure(model, last);
    }
  }
  throw last;
}

// ---------- Live (ephemeral tokens) ----------

export interface LiveSetup {
  model: string;
  generationConfig: { responseModalities: ['AUDIO']; speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } };
  systemInstruction: { parts: Array<{ text: string }> };
  inputAudioTranscription: Record<string, never>;
  outputAudioTranscription: Record<string, never>;
  contextWindowCompression: { slidingWindow: Record<string, never> };
}

export function liveSetup(model: string, voice: string, prompt: string): LiveSetup {
  return {
    model: `models/${model}`,
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    systemInstruction: { parts: [{ text: prompt }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
  };
}

/** How long a token may start a session, and how long it lives. */
export const LIVE_START_WINDOW_MS = 2 * 60_000;
export const LIVE_TOKEN_TTL_MS = 30 * 60_000;

/**
 * The bodies tried for POST /v1beta/auth_tokens, in order. Google's guide
 * locks a token with `liveConnectConstraints { model, config }`; its API
 * reference names `bidiGenerateContentSetup` instead. The last body is an
 * unlocked one-use token (the page still sends this setup), so a change in
 * Google's field names cannot take Live down. The probe reports which worked.
 */
export function tokenBodies(setup: LiveSetup, now = Date.now()): Array<{ shape: 'constraints' | 'setup' | 'plain'; body: Record<string, unknown> }> {
  const times = { uses: 1, expireTime: new Date(now + LIVE_TOKEN_TTL_MS).toISOString(), newSessionExpireTime: new Date(now + LIVE_START_WINDOW_MS).toISOString() };
  const config = {
    responseModalities: setup.generationConfig.responseModalities,
    speechConfig: setup.generationConfig.speechConfig,
    systemInstruction: setup.systemInstruction,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: setup.contextWindowCompression,
  };
  return [
    { shape: 'constraints', body: { ...times, liveConnectConstraints: { model: setup.model, config } } },
    { shape: 'setup', body: { ...times, bidiGenerateContentSetup: setup } },
    { shape: 'plain', body: times },
  ];
}

export async function mintLiveToken(env: AiEnv, setup: LiveSetup, now = Date.now()): Promise<{ token: string; shape: string; expiresAt: string }> {
  const key = geminiKey(env);
  if (!key) throw new ProviderError('not_configured');
  let last: ProviderError = new ProviderError('upstream');
  for (const { shape, body } of tokenBodies(setup, now)) {
    const sig = AbortSignal.timeout(10_000);
    try {
      const res = await fetch(`${GEMINI}/v1beta/auth_tokens`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: sig,
      });
      if (!res.ok) {
        last = classifyHttp(res.status, res.headers, await errorText(res));
        // Only a refused body shape moves on to the next shape.
        if (last.kind === 'bad_request') continue;
        throw last;
      }
      const j = (await res.json().catch(() => null)) as { name?: unknown } | null;
      if (typeof j?.name !== 'string' || !j.name) throw new ProviderError('upstream');
      return { token: j.name, shape, expiresAt: body.expireTime as string };
    } catch (e) {
      throw asProviderError(e, sig);
    }
  }
  throw last;
}
