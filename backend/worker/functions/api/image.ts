/** Text-to-image for VinaX AI. Returns a data URL; the client renders it in
 *  the chat. Fully gated: if the key lacks image access, the client gets an
 *  honest error instead of a hang.
 *
 *  10.3 — every FREE image model on the four keys, not one hard-coded one:
 *    POST { prompt, provider?, model? }
 *    200  { image: <data URL>, model: <published name>, modelId, provider }
 *    400  { error: 'bad_request' | 'unknown_model' }   (a pick that is not on
 *         the live free list is refused, never forwarded)
 *    503  { error: 'not_configured', reason } | { error: 'ai_disabled' | 'ai_over_budget' }
 *    502  { error: <upstream reason>, status }
 *  No pick → the first free image model available (NVIDIA's hosted models,
 *  then OpenRouter's free ones), and on failure the next one. An exact pick
 *  runs alone. The model list lives in _lib/catalog.ts, the provider calls in
 *  _lib/media.ts. */
import { methodNotAllowed, rateLimitAsync } from '../_lib/ratelimit';
import { aiBlockCode, aiGate, logAiEvent, logAiRefusal, noteProviderFailure, type AiEnv } from '../_lib/ai';
import { readJsonCapped } from '../_lib/body';
import { generateImage, pickMedia } from '../_lib/media';
import { type SupabaseEnv } from '../_lib/supabase';

type Env = AiEnv & SupabaseEnv;

/** A prompt plus the two ids — nothing large belongs in this body. */
const MAX_BODY_BYTES = 8_000;
/** How long an automatic pick keeps trying the next model. */
const AUTO_BUDGET_MS = 50_000;

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });

/** POST-only: answer GET with an honest 405 instead of the SPA shell (DQA-07). */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const limited = await rateLimitAsync(context.request, 'image', { capacity: 6, refillPerMinute: 3 }, context.env);
  if (limited) return limited;
  try {
    return await handleImage(context);
  } catch {
    // Was returning 200 with error body — client `res.ok` never fired and
    // the missing image silently dropped from the AI reply (audit finding
    // M13). 502 makes the failure visible.
    return json({ error: 'engine_unreachable' }, 502);
  }
};

const handleImage = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = context;
  const client = request.headers.get('x-vinax-client') === 'app' ? 'app' : 'web';
  const read = await readJsonCapped<{ prompt?: unknown; provider?: unknown; model?: unknown } | null>(request, MAX_BODY_BYTES);
  if (!read.ok) return read.reason === 'too_large' ? json({ error: 'too_large' }, 413) : json({ error: 'bad_request' }, 400);
  const body = read.value && typeof read.value === 'object' ? read.value : null;
  const prompt = (typeof body?.prompt === 'string' ? body.prompt : '').trim().slice(0, 600);
  if (prompt.length < 3) return json({ error: 'bad_request' }, 400);
  // 7.2.0 — the owner's AI switches and spend caps.
  const blocked = await aiGate(env, 'image');
  if (blocked) {
    // Logged (error ai_disabled / ai_over_budget) for the console.
    void logAiRefusal(env, 'image', blocked, client, context.waitUntil);
    return json({ error: aiBlockCode(blocked) }, 503);
  }
  // 10.3 — validated against the live free image list before any key is used.
  // No image model at all means the feature is unavailable, not that the
  // client sent a bad request — surface as 503 (audit finding M13).
  const pick = await pickMedia(env, 'image', body?.provider, body?.model);
  if (!pick.ok) return json({ error: pick.error, ...(pick.reason ? { reason: pick.reason } : {}) }, pick.status);
  const t0 = Date.now();
  let last: { status: number; reason: string } = { status: 0, reason: 'engine_unreachable' };
  for (const { provider, model } of pick.choices) {
    if (Date.now() - t0 > AUTO_BUDGET_MS) break;
    const r = await generateImage(env, provider, model.id, prompt);
    const log = logAiEvent(env, {
      feature: 'image',
      model: `${model.id} @${provider}`,
      ok: r.ok,
      status: r.ok ? 200 : r.status,
      error: r.ok ? null : r.reason,
      client,
      latency_ms: Date.now() - t0,
    });
    if (context.waitUntil) context.waitUntil(log);
    if (r.ok) {
      // Built by concatenation: the data URL is megabytes of base64.
      return new Response(
        `{"image":"${r.value}","model":${JSON.stringify(model.name)},"modelId":${JSON.stringify(model.id)},"provider":${JSON.stringify(provider)}}`,
        { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } },
      );
    }
    noteProviderFailure(provider, model.id, r.status, r.body);
    last = { status: r.status, reason: r.reason };
    // An exact pick runs alone; a filtered prompt is the prompt, not the model.
    if (pick.exact || r.reason === 'content_filtered') break;
  }
  return json({ error: last.reason, status: last.status }, last.reason === 'content_filtered' ? 422 : 502);
};
