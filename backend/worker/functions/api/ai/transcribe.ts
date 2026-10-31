/**
 * VinaX AI — POST /api/ai/transcribe: a dictation clip becomes text.
 *
 *   body: the clip's bytes as they are (not multipart), with its Content-Type
 *   (audio/webm, audio/mp4, audio/ogg, audio/wav, audio/mpeg, audio/flac)
 *   and Content-Length. At most 25 MB (the page records at most 2 minutes).
 *
 *   → 200 { text }            ('' when nothing was said)
 *   → 400 bad_request · 401 signed_out · 411 length_required · 413 too_large
 *   → 415 unsupported_type · 429 rate_limited | voice_busy
 *   → 503 ai_not_configured | ai_disabled | unavailable | voice_unavailable
 *
 * Groq Whisper (turbo, then large) first; Gemini when Groq has no key, is
 * resting or fails. The clip is not stored, and neither is the text: the
 * page puts it in the composer for the listener to check and send.
 */
import { json, CORS } from '../../_lib/authShared';
import { readCapped } from '../../_lib/body';
import { voiceFailure, voiceGate } from '../../_lib/ai/voiceGate';
import {
  AUDIO_TYPES, geminiTranscribe, groqTranscribe, MAX_CLIP_BYTES, MAX_GEMINI_CLIP_BYTES, noteVoiceFailure, STT_GEMINI_MODELS, STT_GROQ_MODELS, voiceResting,
} from '../../_lib/ai/voice';
import { asProviderError } from '../../_lib/ai/errors';
import type { AiEnv } from '../../_lib/ai/types';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': `${CORS['access-control-allow-headers']}, content-length` } });

/** First bytes of the clip formats Whisper reads. */
export function looksLikeAudio(b: Uint8Array): boolean {
  const ascii = (at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
  return (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) // WebM / Matroska
    || ascii(4, 'ftyp') // MP4 / M4A
    || ascii(0, 'OggS')
    || (ascii(0, 'RIFF') && ascii(8, 'WAVE'))
    || ascii(0, 'fLaC')
    || ascii(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0); // MP3
}

export const onRequestPost = async (ctx: { request: Request; env: AiEnv }): Promise<Response> => {
  const { request, env } = ctx;
  const gate = await voiceGate(request, env, 'ai-transcribe', 'dictation');
  if (!gate.ok) return gate.res;

  const mime = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!(AUDIO_TYPES as readonly string[]).includes(mime)) return json({ error: 'unsupported_type' }, 415);
  const length = Number(request.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0) return json({ error: 'length_required' }, 411);
  if (length > MAX_CLIP_BYTES) return json({ error: 'too_large' }, 413);
  const clip = await readCapped(request.body, MAX_CLIP_BYTES);
  if (!clip) return json({ error: 'too_large' }, 413);
  if (clip.length < 16 || !looksLikeAudio(clip)) return json({ error: 'unsupported_type' }, 415);
  // Whisper reads WebM as video/webm too; Gemini wants an audio type.
  const audioMime = mime === 'video/webm' ? 'audio/webm' : mime;

  const t0 = Date.now();
  const kinds: string[] = [];
  if (env.GROQ_API_KEY?.trim()) {
    for (const model of STT_GROQ_MODELS) {
      if (voiceResting(model)) continue;
      try {
        const text = await groqTranscribe(env, model, clip, audioMime);
        console.log(JSON.stringify({ route: 'ai-transcribe', provider: 'groq', model, ms: Date.now() - t0, bytes: clip.length, ok: true }));
        return json({ text });
      } catch (e) {
        const err = asProviderError(e);
        kinds.push(err.kind);
        noteVoiceFailure(model, err);
        console.log(JSON.stringify({ route: 'ai-transcribe', provider: 'groq', model, ok: false, kind: err.kind, status: err.status }));
      }
    }
  }
  const gemini = STT_GEMINI_MODELS.filter((m) => !voiceResting(m));
  if (env.GEMINI_API_KEY?.trim() && gemini.length && clip.length <= MAX_GEMINI_CLIP_BYTES) {
    try {
      const r = await geminiTranscribe(env, clip, audioMime, gemini);
      console.log(JSON.stringify({ route: 'ai-transcribe', provider: 'gemini', model: r.model, ms: Date.now() - t0, bytes: clip.length, ok: true }));
      return json({ text: r.text });
    } catch (e) {
      const err = asProviderError(e);
      kinds.push(err.kind);
      console.log(JSON.stringify({ route: 'ai-transcribe', provider: 'gemini', ok: false, kind: err.kind, status: err.status }));
    }
  }
  return voiceFailure(kinds);
};
