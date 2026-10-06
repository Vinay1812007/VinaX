/**
 * 10.3 — POST /api/transcribe: speech to text on the free transcription models.
 *
 *   request  { audio: <data URL or base64>, mime?, provider?, model?, language? }
 *            `mime` is required unless the data URL carries it; audio/* (and
 *            the video/webm|mp4 containers a recorder may label it with)
 *   200      { text, model: <published name>, modelId, provider }
 *   400      { error: 'bad_request' | 'unknown_model' }   413 { error: 'too_large' }
 *   429      rate limited
 *   503      { error: 'not_configured', reason } | { error: 'ai_disabled' | 'ai_over_budget' }
 *   502      { error: <upstream reason>, status }
 *
 * Models (from the live free lists, _lib/catalog.ts): Groq's whisper models,
 * then the newest Gemini flash models given the audio inline. No pick → the
 * first available, then the next on failure; an exact pick runs alone. The
 * audio is sent to the provider only — it is never stored or logged.
 */
import { aiBlockCode, aiGate, logAiEvent, logAiRefusal, noteProviderFailure, type AiEnv } from '../_lib/ai';
import { readJsonCapped } from '../_lib/body';
import { fromBase64, pickMedia, transcribe } from '../_lib/media';
import { methodNotAllowed, rateLimitAsync } from '../_lib/ratelimit';
import { type SupabaseEnv } from '../_lib/supabase';

type Env = AiEnv & SupabaseEnv;

/** About six megabytes of audio, base64-encoded, plus the envelope. */
export const MAX_BODY_BYTES = 8_000_000;
/** How long an automatic pick keeps trying the next model. */
const AUTO_BUDGET_MS = 45_000;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-vinax-client',
};

const json = (b: unknown, status = 200): Response =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

/** POST-only: answer GET with an honest 405 instead of the SPA shell. */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

const AUDIO_MIME = /^(?:audio\/[\w.+-]+|video\/(?:webm|mp4))(?:;[\w=.+-]+)*$/i;

/** The request's audio bytes and mime type, or null when it is not audio. Exported for tests. */
export function readAudio(audio: unknown, mimeRaw: unknown): { bytes: Uint8Array; mime: string } | null {
  if (typeof audio !== 'string' || audio.length < 16) return null;
  let mime = typeof mimeRaw === 'string' ? mimeRaw.trim().toLowerCase() : '';
  let b64 = audio;
  const m = /^data:([^;,]+)((?:;[^;,]+)*);base64,/i.exec(audio);
  if (m) {
    mime = mime || m[1].toLowerCase();
    b64 = audio.slice(m[0].length);
  }
  if (!AUDIO_MIME.test(mime) || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return null;
  const bytes = fromBase64(b64);
  if (!bytes || bytes.length < 16) return null;
  return { bytes, mime: mime.split(';')[0] };
}

export const onRequestPost = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  // Like /api/tts: a voice turn is one short clip, a burst is a few.
  const limited = await rateLimitAsync(context.request, 'transcribe', { capacity: 30, refillPerMinute: 30 }, context.env);
  if (limited) return limited;
  try {
    return await handle(context);
  } catch (e) {
    console.warn('[transcribe] unhandled exception:', e instanceof Error ? e.name : 'error');
    return json({ error: 'internal' }, 500);
  }
};

async function handle(context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> {
  const { request, env } = context;
  const client = request.headers.get('x-vinax-client') === 'app' ? 'app' : 'web';
  const read = await readJsonCapped<Record<string, unknown> | null>(request, MAX_BODY_BYTES);
  if (!read.ok) return read.reason === 'too_large' ? json({ error: 'too_large' }, 413) : json({ error: 'bad_request' }, 400);
  const body = read.value && typeof read.value === 'object' && !Array.isArray(read.value) ? read.value : null;
  if (!body) return json({ error: 'bad_request' }, 400);
  const audio = readAudio(body.audio, body.mime);
  if (!audio) return json({ error: 'bad_request' }, 400);
  const language = typeof body.language === 'string' && /^[a-z]{2,3}$/i.test(body.language.trim()) ? body.language.trim().toLowerCase() : null;

  const blocked = await aiGate(env, 'transcribe');
  if (blocked) {
    void logAiRefusal(env, 'transcribe', blocked, client, context.waitUntil);
    return json({ error: aiBlockCode(blocked) }, 503);
  }
  const pick = await pickMedia(env, 'transcription', body.provider, body.model);
  if (!pick.ok) return json({ error: pick.error, ...(pick.reason ? { reason: pick.reason } : {}) }, pick.status);

  const t0 = Date.now();
  let last = { status: 0, reason: 'engine_unreachable' };
  for (const { provider, model } of pick.choices) {
    if (Date.now() - t0 > AUTO_BUDGET_MS) break;
    const r = await transcribe(env, provider, model.id, audio.bytes, audio.mime, language);
    const log = logAiEvent(env, { feature: 'transcribe', model: `${model.id} @${provider}`, ok: r.ok, status: r.ok ? 200 : r.status, error: r.ok ? null : r.reason, client, latency_ms: Date.now() - t0 });
    if (context.waitUntil) context.waitUntil(log);
    if (r.ok) return json({ text: r.value, model: model.name, modelId: model.id, provider });
    noteProviderFailure(provider, model.id, r.status, r.body);
    last = { status: r.status, reason: r.reason };
    if (pick.exact) break;
  }
  return json({ error: last.reason, status: last.status }, last.status === 429 ? 429 : 502);
}
