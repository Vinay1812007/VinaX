/**
 * 8.2.0 — POST /api/embed: text → unit-length vectors.
 *
 *   request  { texts: string[] (1–64, each clipped to 512 chars),
 *              kind: 'query' | 'passage' (default 'passage'),
 *              prefer?: string — the model the client already caches }
 *   200      { model, dim, vectors: number[][] }   (vectors[i] ↔ texts[i])
 *   400      { error: 'bad_request' }   413 { error: 'too_large' }
 *   429      rate limited
 *   503      { error: 'no_engine' } — no engine answered (the client keeps
 *            its on-device vectors); { error: 'ai_disabled' | 'ai_over_budget' }
 *            when the owner's AI switch or spend cap refuses.
 *
 * Vectors from different models are not comparable: clients key their cache
 * by `model`. The engine ladder lives in _lib/embed.ts.
 */
import { aiBlockCode, aiGate, type AiEnv } from '../_lib/ai';
import { readJsonCapped } from '../_lib/body';
import { EMBED_DIM, MAX_TEXTS, MAX_TEXT_CHARS, embedTexts, type EmbedKind } from '../_lib/embed';
import { methodNotAllowed, rateLimitAsync } from '../_lib/ratelimit';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-vinax-client',
};

/** 64 texts × 512 characters in a three-byte script, plus the envelope. */
const MAX_BODY_BYTES = 110_000;
/** The whole ladder answers inside this; the client leash sits above it. */
const LADDER_BUDGET_MS = 13_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS_HEADERS },
  });
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS_HEADERS });

/** POST-only: answer GET with an honest 405 instead of the SPA shell. */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export interface EmbedRequest {
  texts: string[];
  kind: EmbedKind;
  prefer: string | null;
}

/** Validate a request body; null when it is not one. */
export function parseEmbedRequest(value: unknown): EmbedRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as { texts?: unknown; kind?: unknown; prefer?: unknown };
  if (!Array.isArray(body.texts) || body.texts.length === 0 || body.texts.length > MAX_TEXTS) return null;
  const texts: string[] = [];
  for (const t of body.texts) {
    if (typeof t !== 'string') return null;
    const clean = t.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
    if (!clean) return null;
    texts.push(clean);
  }
  if (body.kind !== undefined && body.kind !== 'query' && body.kind !== 'passage') return null;
  const kind: EmbedKind = body.kind === 'query' ? 'query' : 'passage';
  const prefer = typeof body.prefer === 'string' && /^[a-z0-9][a-z0-9._/-]{1,80}$/i.test(body.prefer) ? body.prefer : null;
  return { texts, kind, prefer };
}

export const onRequestPost = async (context: { request: Request; env: AiEnv }): Promise<Response> => {
  try {
    return await handlePost(context);
  } catch (e) {
    console.warn('[embed] unhandled exception:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return json({ error: 'internal' }, 500);
  }
};

async function handlePost(context: { request: Request; env: AiEnv }): Promise<Response> {
  const { request, env } = context;
  // A library of a few hundred songs warms in a handful of 64-text batches;
  // search adds one query call per settled natural-language search.
  const limited = await rateLimitAsync(request, 'embed', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const blocked = await aiGate(env, 'embed');
  if (blocked) return json({ error: aiBlockCode(blocked) }, 503);

  const read = await readJsonCapped<unknown>(request, MAX_BODY_BYTES);
  if (!read.ok) return read.reason === 'too_large' ? json({ error: 'too_large' }, 413) : json({ error: 'bad_request' }, 400);
  const parsed = parseEmbedRequest(read.value);
  if (!parsed) return json({ error: 'bad_request' }, 400);

  const result = await embedTexts(env, parsed.texts, parsed.kind, { prefer: parsed.prefer, deadlineAt: Date.now() + LADDER_BUDGET_MS });
  if (!result.ok) return json({ error: 'no_engine' }, 503);
  return json({ model: result.model, dim: result.dim, vectors: result.vectors });
}

/** Exported for tests and for the owner console's documentation. */
export const EMBED_CONTRACT = { maxTexts: MAX_TEXTS, maxChars: MAX_TEXT_CHARS, preferredDim: EMBED_DIM } as const;
