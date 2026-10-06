/**
 * 10.3 — the provider calls behind the media routes: image generation
 * (/api/image), speech (/api/tts), transcription (/api/transcribe) and music
 * (/api/music). Each one is plain HTTPS on the provider's single key (read
 * through providerKey), with the request shape taken from the provider's own
 * published API reference:
 *
 *   image          NVIDIA     POST ai.api.nvidia.com/v1/genai/<org>/<model>
 *                             (artifacts[].base64, or `image` for SD3)
 *                  OpenRouter POST /api/v1/images { model, prompt } → data[].b64_json
 *   speech         Groq       POST /openai/v1/audio/speech (WAV, 200 characters)
 *                  Gemini     generateContent, responseModalities AUDIO +
 *                             speechConfig → 24 kHz 16-bit PCM, wrapped as WAV here
 *                  OpenRouter POST /api/v1/audio/speech (mp3)
 *   transcription  Groq       POST /openai/v1/audio/transcriptions (multipart)
 *                  Gemini     generateContent with the audio inline + "transcribe"
 *                  OpenRouter POST /api/v1/audio/transcriptions { input_audio }
 *   music          OpenRouter chat completions, modalities text+audio, streamed
 *                             (delta.audio.data chunks)
 *
 * Nothing here decides WHICH model runs: the routes validate the pick against
 * the live free lists in ./catalog.ts first. No call here ever carries a web
 * tool, and no key or provider host ever reaches a response or a log line.
 */
import { AI_PROVIDERS, LANE_BASE, providerKey, type AiEnv, type AiProvider } from './ai';
import { NVIDIA_IMAGE_MODELS, findMediaModel, mediaChoices, normaliseProvider, type MediaKind, type MediaModel } from './catalog';
import { geminiGenerate } from './maestro';

/** A provider call's outcome. `status` is the upstream status (0 = network/timeout). */
export type MediaResult<T> = { ok: true; value: T } | { ok: false; status: number; reason: string; body: string };

const fail = (status: number, reason: string, body = ''): { ok: false; status: number; reason: string; body: string } => ({ ok: false, status, reason, body: body.slice(0, 600) });

/** Upstream status → the route's error word. */
export function upstreamReason(status: number): string {
  if (status === 0) return 'engine_unreachable';
  if (status === 401 || status === 403) return 'not_enabled';
  if (status === 404) return 'model_unavailable';
  if (status === 429) return 'rate_limited';
  return 'upstream_error';
}

async function timed(url: string, init: RequestInit, ms: number): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Picking a model
// ---------------------------------------------------------------------------

/** 10.3 — which provider an automatic pick tries first, per kind. */
export const MEDIA_ORDER: Record<MediaKind, readonly AiProvider[]> = {
  image: ['nvidia', 'openrouter', 'gemini', 'groq'],
  speech: ['groq', 'gemini', 'openrouter', 'nvidia'],
  transcription: ['groq', 'gemini', 'openrouter', 'nvidia'],
  music: ['openrouter', 'gemini', 'nvidia', 'groq'],
  embedding: ['nvidia', 'gemini', 'openrouter', 'groq'],
};

export type MediaPick =
  | { ok: true; exact: boolean; choices: Array<{ provider: AiProvider; model: MediaModel }> }
  | { ok: false; status: 400 | 503; error: 'unknown_model' | 'not_configured'; reason?: 'no_key' | 'no_free_model' };

/**
 * 10.3 — the model(s) a media request may run, validated against the live free lists:
 *   provider + model  that exact model, or 400 unknown_model
 *   model only        that model on whichever provider lists it, or 400 unknown_model
 *   provider only     that provider's free models of the kind, in list order
 *   neither           every free model of the kind, providers in MEDIA_ORDER
 * An exact pick is never swapped for another model (the reply names the model
 * that ran). 503 not_configured when no key is set, or no provider lists a
 * free model of the kind right now.
 */
export async function pickMedia(env: AiEnv, kind: MediaKind, providerRaw: unknown, modelRaw: unknown): Promise<MediaPick> {
  const anyKey = AI_PROVIDERS.some((p) => providerKey(env, p) !== null);
  if (!anyKey) return { ok: false, status: 503, error: 'not_configured', reason: 'no_key' };
  const wantProvider = providerRaw === undefined || providerRaw === null || providerRaw === '' ? null : normaliseProvider(providerRaw);
  if (wantProvider === null && providerRaw !== undefined && providerRaw !== null && providerRaw !== '') return { ok: false, status: 400, error: 'unknown_model' };
  const wantModel = typeof modelRaw === 'string' && modelRaw.trim() ? modelRaw.trim() : null;
  if (modelRaw !== undefined && modelRaw !== null && modelRaw !== '' && !wantModel) return { ok: false, status: 400, error: 'unknown_model' };
  if (wantModel) {
    for (const p of wantProvider ? [wantProvider] : MEDIA_ORDER[kind]) {
      const hit = await findMediaModel(env, p, kind, wantModel);
      if (hit) return { ok: true, exact: true, choices: [{ provider: p, model: hit }] };
    }
    return { ok: false, status: 400, error: 'unknown_model' };
  }
  const choices = await mediaChoices(env, kind, wantProvider ? [wantProvider] : MEDIA_ORDER[kind]);
  if (!choices.length) {
    // A named provider that offers nothing of this kind is an unknown pick; no pick at all is "not available".
    if (wantProvider && providerKey(env, wantProvider)) return { ok: false, status: 400, error: 'unknown_model' };
    return { ok: false, status: 503, error: 'not_configured', reason: wantProvider ? 'no_key' : 'no_free_model' };
  }
  return { ok: true, exact: false, choices };
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

/** Bytes → base64, in chunks (a spread of megabytes would overflow the stack). */
export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
/** base64 → bytes, or null when it is not base64. */
export function fromBase64(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** 10.3 — raw 16-bit little-endian PCM wrapped in a RIFF/WAVE header, so a
 *  browser can play it (the Gemini TTS answer is headerless PCM). */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24_000, channels = 1, bits = 16): Uint8Array<ArrayBuffer> {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(at + i, s.charCodeAt(i));
  };
  const blockAlign = (channels * bits) / 8;
  str(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bits, true);
  str(36, 'data');
  v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

/** The sample rate a PCM mime type names ("audio/L16;codec=pcm;rate=24000"), else 24 kHz. */
export function pcmRate(mime: string): number {
  const m = /rate=(\d{4,6})/i.exec(mime);
  return m ? Number(m[1]) : 24_000;
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export const IMAGE_TIMEOUT_MS = 45_000;

/** The NVIDIA genai request body for one fixed image model (shapes from NVIDIA's API reference). */
export function nvidiaImageBody(model: string, prompt: string, seed: number): Record<string, unknown> | null {
  const spec = NVIDIA_IMAGE_MODELS.find((m) => m.id === model);
  if (!spec) return null;
  if (spec.shape === 'flux') {
    const schnell = model.endsWith('schnell');
    return { prompt, mode: 'base', width: 1024, height: 1024, seed, samples: 1, steps: schnell ? 4 : 28, cfg_scale: schnell ? 0 : 3.5 };
  }
  if (spec.shape === 'flux2') return { prompt, mode: 'Image Generation', width: 1024, height: 1024, seed, samples: 1, steps: 4, cfg_scale: 0 };
  if (spec.shape === 'sd3') return { prompt, negative_prompt: '', mode: 'text-to-image', aspect_ratio: '1:1', seed, steps: 28, cfg_scale: 5 };
  return { text_prompts: [{ text: prompt, weight: 1 }], seed, steps: 25 };
}

/** One image, as a data URL. The payload is a ~2 MB JSON with one huge base64
 *  field: a full JSON.parse can blow the edge CPU budget, so it is read by regex. */
export async function generateImage(env: AiEnv, provider: AiProvider, model: string, prompt: string): Promise<MediaResult<string>> {
  const key = providerKey(env, provider);
  if (!key) return fail(0, 'not_configured');
  const seed = Math.floor(Math.random() * 4_294_967_295);
  let res: Response | null;
  if (provider === 'nvidia') {
    const body = nvidiaImageBody(model, prompt, seed);
    if (!body) return fail(400, 'unknown_model');
    res = await timed(`https://ai.api.nvidia.com/v1/genai/${model}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    }, IMAGE_TIMEOUT_MS);
  } else if (provider === 'openrouter') {
    res = await timed(`${LANE_BASE.router}/images`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, n: 1 }),
    }, IMAGE_TIMEOUT_MS);
  } else {
    return fail(400, 'unknown_model');
  }
  if (!res) return fail(0, 'engine_unreachable');
  const txt = await res.text().catch(() => '');
  if (!res.ok) return fail(res.status, upstreamReason(res.status), txt);
  if (/"finish_?[rR]eason"\s*:\s*"CONTENT_FILTERED"/.test(txt)) return fail(422, 'content_filtered');
  const b64 = /"(?:b64_json|base64|image)"\s*:\s*"([A-Za-z0-9+/=]{100,})"/.exec(txt)?.[1];
  if (!b64) return fail(502, 'empty_image');
  const mime = /"media_type"\s*:\s*"(image\/[\w.+-]+)"/.exec(txt)?.[1] ?? (provider === 'nvidia' ? 'image/jpeg' : 'image/png');
  return { ok: true, value: `data:${mime};base64,${b64}` };
}

// ---------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------

/** Per-provider input caps: Groq's is upstream (200, probed live); the others keep one call short. */
export const SPEECH_INPUT_MAX: Record<AiProvider, number> = { groq: 200, gemini: 1000, openrouter: 1000, nvidia: 0 };
export const SPEECH_LEASH_MS = 6_000;
const SPEECH_LONG_LEASH_MS = 25_000;

/** Clip text under a cap at a word boundary. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const sp = text.lastIndexOf(' ', max);
  return text.slice(0, sp > max * 0.4 ? sp : max).trim();
}

/** Spoken audio for one short text. Groq and OpenRouter stream their audio
 *  body straight through; Gemini answers base64 PCM that is wrapped as WAV. */
export async function speak(env: AiEnv, provider: AiProvider, model: string, voice: string | null, text: string): Promise<MediaResult<{ body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>; type: string }>> {
  const key = providerKey(env, provider);
  if (!key) return fail(0, 'not_configured');
  const input = clipText(text, SPEECH_INPUT_MAX[provider] || 200);
  if (provider === 'groq' || provider === 'openrouter') {
    const groq = provider === 'groq';
    const res = await timed(groq ? `${LANE_BASE.scholar}/audio/speech` : `${LANE_BASE.router}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input, ...(voice ? { voice } : {}), response_format: groq ? 'wav' : 'mp3' }),
    }, groq ? SPEECH_LEASH_MS : SPEECH_LONG_LEASH_MS);
    if (!res) return fail(0, 'engine_unreachable');
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      return fail(res.status, upstreamReason(res.status), body);
    }
    return { ok: true, value: { body: res.body, type: res.headers.get('content-type') ?? (groq ? 'audio/wav' : 'audio/mpeg') } };
  }
  if (provider === 'gemini') {
    let res: Response | null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SPEECH_LONG_LEASH_MS);
    try {
      res = await geminiGenerate(key, model, {
        contents: [{ role: 'user', parts: [{ text: input }] }],
        generationConfig: { responseModalities: ['AUDIO'], ...(voice ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } : {}) },
      }, ctrl.signal);
    } catch {
      res = null;
    } finally {
      clearTimeout(timer);
    }
    if (!res) return fail(0, 'engine_unreachable');
    const txt = await res.text().catch(() => '');
    if (!res.ok) return fail(res.status, upstreamReason(res.status), txt);
    const data = /"data"\s*:\s*"([A-Za-z0-9+/=]+)"/.exec(txt)?.[1];
    const pcm = data ? fromBase64(data) : null;
    if (!pcm || !pcm.length) return fail(502, 'empty_audio');
    const mime = /"mime_?[tT]ype"\s*:\s*"([^"]+)"/.exec(txt)?.[1] ?? '';
    // A WAV answer already has its header; raw PCM (the documented default) gets one.
    const wav = /wav/i.test(mime) ? pcm : pcmToWav(pcm, pcmRate(mime));
    return { ok: true, value: { body: wav, type: 'audio/wav' } };
  }
  return fail(400, 'unknown_model');
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

export const TRANSCRIBE_TIMEOUT_MS = 30_000;
/** The instruction a Gemini model transcribes under. */
export const TRANSCRIBE_PROMPT =
  'Transcribe this audio verbatim, in the language and script that is spoken. Reply with only the transcript: no notes, labels, timestamps or translation. If nothing is spoken, reply with nothing.';

/** The container a mime type names, for file names and OpenRouter's `format`. */
export function audioFormat(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('flac')) return 'flac';
  return 'wav';
}

export async function transcribe(env: AiEnv, provider: AiProvider, model: string, audio: Uint8Array, mime: string, language: string | null): Promise<MediaResult<string>> {
  const key = providerKey(env, provider);
  if (!key) return fail(0, 'not_configured');
  let res: Response | null;
  if (provider === 'groq') {
    const form = new FormData();
    form.append('file', new Blob([audio as Uint8Array<ArrayBuffer>], { type: mime }), `audio.${audioFormat(mime)}`);
    form.append('model', model);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (language) form.append('language', language);
    res = await timed(`${LANE_BASE.scholar}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form }, TRANSCRIBE_TIMEOUT_MS);
  } else if (provider === 'openrouter') {
    res = await timed(`${LANE_BASE.router}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input_audio: { data: toBase64(audio), format: audioFormat(mime) }, ...(language ? { language } : {}) }),
    }, TRANSCRIBE_TIMEOUT_MS);
  } else if (provider === 'gemini') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TRANSCRIBE_TIMEOUT_MS);
    try {
      res = await geminiGenerate(key, model, {
        contents: [{ role: 'user', parts: [{ text: language ? `${TRANSCRIBE_PROMPT} The language is probably "${language}".` : TRANSCRIBE_PROMPT }, { inlineData: { mimeType: mime, data: toBase64(audio) } }] }],
        generationConfig: { temperature: 0 },
      }, ctrl.signal);
    } catch {
      res = null;
    } finally {
      clearTimeout(timer);
    }
  } else {
    return fail(400, 'unknown_model');
  }
  if (!res) return fail(0, 'engine_unreachable');
  const txt = await res.text().catch(() => '');
  if (!res.ok) return fail(res.status, upstreamReason(res.status), txt);
  let j: unknown;
  try {
    j = JSON.parse(txt);
  } catch {
    return fail(502, 'empty_transcript');
  }
  if (provider === 'gemini') {
    const parts = (j as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }> }).candidates?.[0]?.content?.parts ?? [];
    return { ok: true, value: parts.filter((p) => p.thought !== true && typeof p.text === 'string').map((p) => p.text as string).join('').trim() };
  }
  const text = (j as { text?: unknown }).text;
  return typeof text === 'string' ? { ok: true, value: text.trim() } : fail(502, 'empty_transcript');
}

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

export const MUSIC_TIMEOUT_MS = 90_000;
/** A generated track larger than this is refused rather than inlined. */
export const MUSIC_MAX_BYTES = 12_000_000;

/** One generated track (OpenRouter's audio output: streamed `delta.audio.data` chunks, mp3). */
export async function generateMusic(env: AiEnv, provider: AiProvider, model: string, prompt: string): Promise<MediaResult<{ audio: Uint8Array; mime: string }>> {
  const key = providerKey(env, provider);
  if (!key) return fail(0, 'not_configured');
  if (provider !== 'openrouter') return fail(400, 'unknown_model');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MUSIC_TIMEOUT_MS);
  try {
    const res = await fetch(`${LANE_BASE.router}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], modalities: ['text', 'audio'], audio: { format: 'mp3' }, stream: true }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      return fail(res.status, upstreamReason(res.status), body);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    let format = 'mp3';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data) as { choices?: Array<{ delta?: { audio?: { data?: unknown; format?: unknown } } }> };
          const a = j.choices?.[0]?.delta?.audio;
          if (typeof a?.format === 'string') format = a.format;
          const bytes = typeof a?.data === 'string' ? fromBase64(a.data) : null;
          if (bytes) {
            total += bytes.length;
            if (total > MUSIC_MAX_BYTES) {
              await reader.cancel().catch(() => undefined);
              return fail(413, 'too_large');
            }
            chunks.push(bytes);
          }
        } catch {
          /* skip a malformed chunk */
        }
      }
    }
    if (!total) return fail(502, 'empty_audio');
    const audio = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      audio.set(c, at);
      at += c.length;
    }
    const mime = format === 'wav' ? 'audio/wav' : format === 'flac' ? 'audio/flac' : format === 'opus' ? 'audio/ogg' : 'audio/mpeg';
    return { ok: true, value: { audio, mime } };
  } catch {
    return fail(0, 'engine_unreachable');
  } finally {
    clearTimeout(timer);
  }
}
