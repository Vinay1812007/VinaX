/**
 * VinaX AI — POST /api/ai/speak: Read aloud. The page sends a reply's words
 * (markup already taken out, at most 6,000 characters); the Worker reads
 * them in pieces and streams each piece's audio as soon as it is ready, so
 * playback starts on the first piece.
 *
 *   { text, voice?: "<Orpheus voice>", liveVoice?: "<Gemini voice>" }
 *
 *   → 200 application/x-vinax-speech: a run of frames, each
 *       [kind: 1 byte][length: 4 bytes, big-endian][payload]
 *       kind 1  audio file:   "<mime>\n" then the file's bytes (Orpheus: WAV)
 *       kind 2  base64 audio: "<mime>\n<base64>" (Gemini: WAV, or 16-bit PCM when the mime says L16)
 *       kind 3  stopped:      {"error": "voice_busy" | "voice_unavailable"} (a later piece failed; nothing follows)
 *   → 400 bad_request · 401 signed_out · 413 too_long
 *   → 429 rate_limited | voice_busy · 503 ai_not_configured | ai_disabled | unavailable | voice_unavailable
 *
 * Who reads: Groq Orpheus for short replies (Arabic text gets the Arabic
 * model), one Gemini voice for long ones (see planSpeech). When an engine
 * fails mid-way the rest of the text goes to the next one. Nothing is stored.
 */
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { voiceFailure, voiceGate } from '../../_lib/ai/voiceGate';
import {
  DEFAULT_LIVE_VOICE, DEFAULT_READ_VOICE, GEMINI_TTS_CHARS, geminiSpeak, geminiTtsModels, LIVE_VOICES, noteVoiceFailure, orpheusSpeak, planSpeech, READ_VOICES, splitSpeech,
  type SpeechAudio,
} from '../../_lib/ai/voice';
import { asProviderError, type ProviderError } from '../../_lib/ai/errors';
import type { AiEnv } from '../../_lib/ai/types';

export const MAX_SPEAK_CHARS = 6_500;
/** Upstream calls one Read aloud may make (the free plan allows 50 subrequests). */
export const MAX_SPEAK_CALLS = 40;

export const FRAME_FILE = 1;
export const FRAME_BASE64 = 2;
export const FRAME_STOPPED = 3;

const enc = new TextEncoder();

export function frame(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = kind;
  new DataView(out.buffer).setUint32(1, payload.length);
  out.set(payload, 5);
  return out;
}

export function audioFrame(a: SpeechAudio): Uint8Array {
  if (a.kind === 'file') {
    const head = enc.encode(`${a.mime}\n`);
    const payload = new Uint8Array(head.length + a.bytes.length);
    payload.set(head);
    payload.set(a.bytes, head.length);
    return frame(FRAME_FILE, payload);
  }
  return frame(FRAME_BASE64, enc.encode(`${a.mime}\n${a.data}`));
}

interface Ctx { request: Request; env: AiEnv; waitUntil?: (p: Promise<unknown>) => void }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS' } });

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  const { request, env } = ctx;
  const gate = await voiceGate(request, env, 'ai-speak', 'readAloud');
  if (!gate.ok) return gate.res;
  const read = await readJsonCapped<{ text?: unknown; voice?: unknown; liveVoice?: unknown } | null>(request, 64 * 1024);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_long' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const body = read.value && typeof read.value === 'object' ? read.value : {};
  if (typeof body.text !== 'string') return json({ error: 'bad_request' }, 400);
  const text = body.text.replace(/\s+/g, ' ').trim();
  if (!text) return json({ error: 'bad_request' }, 400);
  if (text.length > MAX_SPEAK_CHARS) return json({ error: 'too_long' }, 413);
  const voices = {
    read: (READ_VOICES as readonly string[]).includes(body.voice as string) ? (body.voice as string) : DEFAULT_READ_VOICE,
    live: (LIVE_VOICES as readonly string[]).includes(body.liveVoice as string) ? (body.liveVoice as string) : DEFAULT_LIVE_VOICE,
  };
  const plan = planSpeech(env, text, voices);
  if (!plan) return voiceFailure([]);

  // The reading, piece by piece, moving to the next engine when one fails.
  let { engine, model, voice } = plan;
  let queue = [...plan.pieces];
  let calls = 0;
  const kinds: string[] = [];
  const tried = new Set<string>();
  const t0 = Date.now();
  const aborted = new AbortController();
  const next = async (): Promise<SpeechAudio | null> => {
    while (queue.length) {
      if (aborted.signal.aborted) return null;
      const piece = queue[0];
      calls += 1;
      try {
        const audio = engine === 'orpheus'
          ? await orpheusSpeak(env, model, voice, piece, aborted.signal)
          : await geminiSpeak(env, model, voice, piece, aborted.signal);
        queue.shift();
        tried.clear();
        return audio;
      } catch (e) {
        if (aborted.signal.aborted) return null;
        const err: ProviderError = asProviderError(e);
        kinds.push(err.kind);
        tried.add(model);
        noteVoiceFailure(model, err);
        console.log(JSON.stringify({ route: 'ai-speak', engine, model, ok: false, kind: err.kind, status: err.status }));
        const gemini = geminiTtsModels(env).filter((m) => !tried.has(m));
        if (!gemini.length || calls >= MAX_SPEAK_CALLS) throw err;
        if (engine === 'orpheus') {
          // The rest of the reply in one Gemini voice, in Gemini-sized pieces.
          queue = splitSpeech(queue.join(' '), GEMINI_TTS_CHARS);
          engine = 'gemini';
          voice = voices.live;
        }
        model = gemini[0];
      }
    }
    return null;
  };

  let first: SpeechAudio | null;
  try {
    first = await next();
  } catch {
    return voiceFailure(kinds);
  }
  if (!first) return voiceFailure(kinds);
  const opening = first;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const pump = (async () => {
    let pieces = 1;
    try {
      await writer.write(audioFrame(opening));
      for (;;) {
        if (calls >= MAX_SPEAK_CALLS && queue.length) throw new Error('too_many_calls');
        const audio = await next();
        if (!audio) break;
        await writer.write(audioFrame(audio));
        pieces += 1;
      }
      await writer.close();
    } catch {
      // The listener stopped (the write failed), or a piece could not be read.
      aborted.abort();
      const busy = kinds.length > 0 && kinds.every((k) => k === 'rate' || k === 'quota');
      await writer.write(frame(FRAME_STOPPED, enc.encode(JSON.stringify({ error: busy ? 'voice_busy' : 'voice_unavailable' })))).catch(() => undefined);
      await writer.close().catch(() => undefined);
    } finally {
      console.log(JSON.stringify({ route: 'ai-speak', engine, model, ok: queue.length === 0, pieces, chars: text.length, ms: Date.now() - t0 }));
    }
  })();
  if (ctx.waitUntil) ctx.waitUntil(pump);
  return new Response(readable, { status: 200, headers: { ...CORS, 'content-type': 'application/x-vinax-speech', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
};
