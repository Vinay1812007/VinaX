/**
 * Server TTS for live voice chat — turns one short reply chunk into natural
 * spoken audio with a studio-quality female voice. POST { text }; answers
 * with streamed WAV audio on success and an honest JSON envelope on any
 * failure — the client falls back to the browser's own speech engine, so an
 * error here never silences a reply.
 *
 * Rides the scholar lane's key (VINAX_GROQ_API_KEY) against the provider's
 * OpenAI-compatible audio/speech endpoint — plain HTTPS, no SDK, no gRPC.
 * Probed live 2026-07-18: the only served speech models are the Orpheus v1
 * pair (english + arabic-saudi); wav is the ONLY response_format and input
 * is hard-capped at 200 characters upstream, so this route clips overlong
 * text at a word boundary instead of failing the request.
 *
 * 10.3 — every FREE speech model on the four keys:
 *   POST { text, provider?, model?, voice? }
 *   - no `provider`: exactly today's behaviour (Groq, the listener's Groq
 *     voice model when the key serves it, else the default; a bad persona
 *     falls back to the default persona) — older clients keep working.
 *   - with `provider`: the model (default: that provider's first free speech
 *     model) and the voice (default: the model's first) are validated against
 *     the live list of GET /api/voices — 400 unknown_model / unknown_voice
 *     otherwise, never forwarded. Groq answers WAV, Gemini's PCM is wrapped as
 *     WAV here, OpenRouter answers mp3 (its content type says so).
 */
import { methodNotAllowed, rateLimitAsync } from '../_lib/ratelimit';
import { findMediaModel, isServedVoiceModel, normaliseProvider } from '../_lib/catalog';
import { aiBlockCode, aiGate, logAiEvent, logAiRefusal, noteProviderFailure, providerKey, type AiEnv } from '../_lib/ai';
import { pickMedia, speak } from '../_lib/media';
import { readJsonCapped } from '../_lib/body';
import { type SupabaseEnv } from '../_lib/supabase';

type Env = AiEnv & SupabaseEnv;

const SPEECH_ENDPOINT = 'https://api.groq.com/openai/v1/audio/speech';
/** Default speech model — used when the caller names none, or names one the
 *  key does not currently serve. v5.26.0: no longer the ONLY option; the
 *  listener picks from the models the key actually serves (see
 *  _lib/catalog.ts fetchVoiceCatalog and GET /api/voices). */
const TTS_MODEL = 'canopylabs/orpheus-v1-english';
/** Default persona. Served personas on the Orpheus pair, probed live:
 *  female autumn / diana / hannah, male austin / daniel / troy. */
const TTS_VOICE = 'autumn';
/** Personas the upstream accepts. A voice name is forwarded verbatim, so it
 *  is allow-listed rather than pattern-checked — an unknown persona makes the
 *  provider 400 the whole request, which would silence the reply. */
const VOICES = new Set(['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy']);
/** Upstream input hard cap (probed live). */
const INPUT_MAX = 200;
/** Upstream leash — time to response HEADERS; audio then streams through.
 *  The client keeps its own shorter leash and falls back to browser speech. */
const UPSTREAM_LEASH_MS = 6000;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

/** POST-only: answer GET with an honest 405 instead of the SPA shell (DQA-07). */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = context;
  // Voice chat speaks sentence-by-sentence, so one turn is a small burst of
  // requests — capacity covers a long reply, refill covers steady listening.
  const limited = await rateLimitAsync(request, 'tts', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const json = (b: unknown, status = 200): Response =>
    new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

  // 10.3 — a capped read: one short sentence and three ids.
  const read = await readJsonCapped<{ text?: unknown; model?: unknown; voice?: unknown; provider?: unknown } | null>(request, 16_000);
  if (!read.ok && read.reason === 'too_large') return json({ error: 'too_large' }, 413);
  const body = read.ok && read.value && typeof read.value === 'object' ? read.value : null;
  // 10.3 — a named provider takes the validated path below.
  if (body && body.provider !== undefined && body.provider !== null && body.provider !== '') return speakPicked(context, body, json);

  const key = providerKey(env, 'groq');
  if (!key) return json({ error: 'not_configured' }, 503);
  // 7.2.0 — the owner's AI switches and spend caps; the client falls back to
  // the device's own speech engine on any non-2xx.
  const blocked = await aiGate(env, 'tts');
  if (blocked) {
    // Logged (error ai_disabled / ai_over_budget) for the console.
    void logAiRefusal(env, 'tts', blocked, request.headers.get('x-vinax-client') === 'app' ? 'app' : 'web', context.waitUntil);
    return json({ error: aiBlockCode(blocked) }, 503);
  }

  const raw = typeof body?.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  if (!raw) return json({ error: 'text_required' }, 400);

  // The listener's chosen voice, if any. Both halves are checked before use:
  // the model against what this key SERVES right now (so a retired slug can
  // never be posted at the provider), the persona against the allow-list
  // above. Anything unrecognised silently falls back to the default rather
  // than failing the request — a bad preference must not cost someone their
  // spoken reply.
  const wantModel = typeof body?.model === 'string' ? body.model.trim() : '';
  const wantVoice = typeof body?.voice === 'string' ? body.voice.trim().toLowerCase() : '';
  const model = wantModel && (await isServedVoiceModel(env, 'groq', wantModel)) ? wantModel : TTS_MODEL;
  const voice = VOICES.has(wantVoice) ? wantVoice : TTS_VOICE;
  let text = raw;
  if (text.length > INPUT_MAX) {
    // Clip at a word boundary under the upstream cap — the client already
    // splits chunks below it, so this is a safety net, not the normal path.
    const sp = text.lastIndexOf(' ', INPUT_MAX);
    text = text.slice(0, sp > 80 ? sp : INPUT_MAX).trim();
  }

  const speak = async (m: string): Promise<Response | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_LEASH_MS);
    try {
      return await fetch(SPEECH_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: m, voice, input: text, response_format: 'wav' }),
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  let upstream = await speak(model);
  // 8.2.0 — the listener's chosen voice model failed (retired between the
  // catalog read and now, or the provider's side of it is down): the default
  // voice model answers instead of the device's fallback voice. A 429 is the
  // key's budget, which the default shares, so it is passed through as is.
  if (model !== TTS_MODEL && (!upstream || (!upstream.ok && upstream.status !== 429))) {
    void upstream?.body?.cancel().catch(() => undefined);
    upstream = await speak(TTS_MODEL);
  }
  if (!upstream) return json({ error: 'unreachable' }, 502);
  if (!upstream.ok || !upstream.body) {
    void upstream.body?.cancel().catch(() => undefined);
    // 429 passes through so the client can tell budget from breakage; every
    // other upstream failure is a plain 502 — never the provider's raw body.
    return json({ error: 'tts_failed', status: upstream.status }, upstream.status === 429 ? 429 : 502);
  }
  // Wrap the upstream body in a TransformStream that aborts if no bytes
  // arrive for STREAM_INACTIVITY_MS. Without this, a Groq response that
  // stalls mid-stream held the edge socket open until the platform's hard
  // wall clock — one stuck call wasted a whole slot (audit finding M15).
  const STREAM_INACTIVITY_MS = 8000;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    start(controllerRef) {
      const bump = (): void => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          try {
            controllerRef.error(new Error('upstream_stall'));
          } catch {
            /* already errored */
          }
        }, STREAM_INACTIVITY_MS);
      };
      bump();
      // Expose the bump for transform() below.
      (controllerRef as unknown as { __bump?: () => void }).__bump = bump;
    },
    transform(chunk, controllerRef) {
      (controllerRef as unknown as { __bump?: () => void }).__bump?.();
      controllerRef.enqueue(chunk);
    },
    flush() {
      if (inactivityTimer) clearTimeout(inactivityTimer);
    },
  });
  return new Response(upstream.body.pipeThrough(transform), {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'audio/wav',
      'cache-control': 'no-store',
      ...CORS,
    },
  });
};

/** 10.3 — speech on a named provider, validated against the live free speech list. */
async function speakPicked(
  context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void },
  body: { text?: unknown; model?: unknown; voice?: unknown; provider?: unknown },
  json: (b: unknown, status?: number) => Response,
): Promise<Response> {
  const { request, env } = context;
  const client = request.headers.get('x-vinax-client') === 'app' ? 'app' : 'web';
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) return json({ error: 'text_required' }, 400);
  const provider = normaliseProvider(body.provider);
  if (!provider) return json({ error: 'unknown_model' }, 400);
  if (!providerKey(env, provider)) return json({ error: 'not_configured' }, 503);
  // The owner's switches first: a refused call spends nothing, not even a list read.
  const blocked = await aiGate(env, 'tts');
  if (blocked) {
    void logAiRefusal(env, 'tts', blocked, client, context.waitUntil);
    return json({ error: aiBlockCode(blocked) }, 503);
  }
  const pick = typeof body.model === 'string' && body.model.trim()
    ? await findMediaModel(env, provider, 'speech', body.model)
    : await pickMedia(env, 'speech', provider, undefined).then((p) => (p.ok ? p.choices[0].model : null));
  if (!pick) return json({ error: 'unknown_model' }, 400);
  const voices = pick.voices ?? [];
  const wantVoice = typeof body.voice === 'string' ? body.voice.trim() : '';
  // Voice names are matched case-insensitively and sent as the list spells them.
  const voice = wantVoice ? (voices.find((v) => v.toLowerCase() === wantVoice.toLowerCase()) ?? null) : (voices[0] ?? null);
  if (wantVoice && !voice) return json({ error: 'unknown_voice' }, 400);
  const t0 = Date.now();
  const r = await speak(env, provider, pick.id, voice, text);
  const log = logAiEvent(env, { feature: 'tts', model: `${pick.id} @${provider}`, ok: r.ok, status: r.ok ? 200 : r.status, error: r.ok ? null : r.reason, client, latency_ms: Date.now() - t0 });
  if (context.waitUntil) context.waitUntil(log);
  if (!r.ok) {
    noteProviderFailure(provider, pick.id, r.status, r.body);
    // 429 passes through so the client can tell budget from breakage — never the provider's raw body.
    return json({ error: 'tts_failed', status: r.status }, r.status === 429 ? 429 : 502);
  }
  return new Response(r.value.body, {
    headers: { 'content-type': r.value.type, 'cache-control': 'no-store', ...CORS },
  });
}
