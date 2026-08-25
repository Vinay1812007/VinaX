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
 */
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';

interface Env {
  VINAX_GROQ_API_KEY?: string;
}

const SPEECH_ENDPOINT = 'https://api.groq.com/openai/v1/audio/speech';
/** Pinned speech model — the provider's expressive English TTS. */
const TTS_MODEL = 'canopylabs/orpheus-v1-english';
/** Voice persona — served female personas: autumn / diana / hannah (male:
 *  austin / daniel / troy). autumn is the warm conversational flagship;
 *  swap this one const to re-voice the whole feature. */
const TTS_VOICE = 'autumn';
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

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  // Voice chat speaks sentence-by-sentence, so one turn is a small burst of
  // requests — capacity covers a long reply, refill covers steady listening.
  const limited = await rateLimit(request, 'tts', { capacity: 30, refillPerMinute: 30 });
  if (limited) return limited;
  const json = (b: unknown, status = 200): Response =>
    new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

  const key = env.VINAX_GROQ_API_KEY;
  if (!key) return json({ error: 'not_configured' }, 503);

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const raw = typeof body?.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  if (!raw) return json({ error: 'text_required' }, 400);
  let text = raw;
  if (text.length > INPUT_MAX) {
    // Clip at a word boundary under the upstream cap — the client already
    // splits chunks below it, so this is a safety net, not the normal path.
    const sp = text.lastIndexOf(' ', INPUT_MAX);
    text = text.slice(0, sp > 80 ? sp : INPUT_MAX).trim();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_LEASH_MS);
  let upstream: Response;
  try {
    upstream = await fetch(SPEECH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text, response_format: 'wav' }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return json({ error: 'unreachable' }, 502);
  }
  clearTimeout(timer);
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
