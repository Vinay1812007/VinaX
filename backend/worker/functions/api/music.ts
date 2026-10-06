/**
 * 10.3 — POST /api/music: a short piece of music from a text prompt, on the
 * FREE music models only.
 *
 *   request  { prompt, provider?, model? }
 *   200      { audio: <data URL>, mime, model: <published name>, modelId, provider }
 *   400      { error: 'bad_request' | 'unknown_model' }   413 { error: 'too_large' }
 *   429      rate limited (3 a minute: one track is a long, heavy call)
 *   503      { error: 'not_configured', reason: 'no_key' | 'no_free_model' }
 *            | { error: 'ai_disabled' | 'ai_over_budget' }
 *   502      { error: <upstream reason>, status }
 *
 * The models come from the live free lists (_lib/catalog.ts). On 2026-10-06
 * no provider listed a free one: the music models priced at zero per token
 * bill per clip in a field the list leaves out, so they are not offered, and
 * this route answers not_configured / no_free_model until one is free.
 */
import { aiBlockCode, aiGate, logAiEvent, logAiRefusal, noteProviderFailure, type AiEnv } from '../_lib/ai';
import { readJsonCapped } from '../_lib/body';
import { generateMusic, pickMedia, toBase64 } from '../_lib/media';
import { methodNotAllowed, rateLimitAsync } from '../_lib/ratelimit';
import { type SupabaseEnv } from '../_lib/supabase';

type Env = AiEnv & SupabaseEnv;

/** A prompt and two ids. */
const MAX_BODY_BYTES = 4_000;

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

export const onRequestPost = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const limited = await rateLimitAsync(context.request, 'music', { capacity: 3, refillPerMinute: 3 }, context.env);
  if (limited) return limited;
  try {
    return await handle(context);
  } catch (e) {
    console.warn('[music] unhandled exception:', e instanceof Error ? e.name : 'error');
    return json({ error: 'internal' }, 500);
  }
};

async function handle(context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> {
  const { request, env } = context;
  const client = request.headers.get('x-vinax-client') === 'app' ? 'app' : 'web';
  const read = await readJsonCapped<Record<string, unknown> | null>(request, MAX_BODY_BYTES);
  if (!read.ok) return read.reason === 'too_large' ? json({ error: 'too_large' }, 413) : json({ error: 'bad_request' }, 400);
  const body = read.value && typeof read.value === 'object' && !Array.isArray(read.value) ? read.value : null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.replace(/\s+/g, ' ').trim().slice(0, 1000) : '';
  if (!body || prompt.length < 3) return json({ error: 'bad_request' }, 400);

  const blocked = await aiGate(env, 'music');
  if (blocked) {
    void logAiRefusal(env, 'music', blocked, client, context.waitUntil);
    return json({ error: aiBlockCode(blocked) }, 503);
  }
  const pick = await pickMedia(env, 'music', body.provider, body.model);
  if (!pick.ok) return json({ error: pick.error, ...(pick.reason ? { reason: pick.reason } : {}) }, pick.status);

  // One model per request: a track is a long call, and a second one would
  // double the wait for an answer the listener did not pick.
  const { provider, model } = pick.choices[0];
  const t0 = Date.now();
  const r = await generateMusic(env, provider, model.id, prompt);
  const log = logAiEvent(env, { feature: 'music', model: `${model.id} @${provider}`, ok: r.ok, status: r.ok ? 200 : r.status, error: r.ok ? null : r.reason, client, latency_ms: Date.now() - t0 });
  if (context.waitUntil) context.waitUntil(log);
  if (!r.ok) {
    noteProviderFailure(provider, model.id, r.status, r.body);
    if (r.reason === 'too_large') return json({ error: 'too_large' }, 502);
    return json({ error: r.reason, status: r.status }, r.status === 429 ? 429 : 502);
  }
  const audio = `data:${r.value.mime};base64,${toBase64(r.value.audio)}`;
  return new Response(
    `{"audio":"${audio}","mime":${JSON.stringify(r.value.mime)},"model":${JSON.stringify(model.name)},"modelId":${JSON.stringify(model.id)},"provider":${JSON.stringify(provider)}}`,
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } },
  );
}
