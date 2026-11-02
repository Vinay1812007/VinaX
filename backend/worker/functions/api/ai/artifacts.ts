/**
 * VinaX AI — GET /api/ai/artifacts?kind=&q=&cursor=: the artifacts gallery,
 * every artifact the signed-in listener's chats made, newest first. One item
 * per artifact per chat (its newest version); metadata only, no content.
 *
 *   → 200 { items: [{ conversationId, conversationTitle, artifactId, messageId, kind, title, language, incomplete, versions, createdAt }], nextCursor }
 *     `kind` is code | html | svg | mermaid | markdown | react; `q` searches titles;
 *     `cursor` is the previous page's nextCursor.
 *   → 400 bad_request · 401 signed_out · 429 rate_limited · 503 unavailable
 *
 * Deleted chats are left out (_lib/ai/gallery.ts).
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { dbConfigured } from '../../_lib/db';
import { decodeCursor, isKind, listArtifacts } from '../../_lib/ai/gallery';
import type { AiEnv } from '../../_lib/ai/types';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS' } });

export const onRequestGet = async ({ request, env }: { request: Request; env: AiEnv }): Promise<Response> => {
  const limited = await rateLimitAsync(request, 'ai-artifacts', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || null;
  if (kind !== null && !isKind(kind)) return json({ error: 'bad_request' }, 400);
  const rawCursor = url.searchParams.get('cursor');
  const cursor = decodeCursor(rawCursor);
  if (rawCursor && !cursor) return json({ error: 'bad_request' }, 400);
  const r = await listArtifacts(env, sub, { kind, query: url.searchParams.get('q'), cursor });
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return json(r.value);
};
