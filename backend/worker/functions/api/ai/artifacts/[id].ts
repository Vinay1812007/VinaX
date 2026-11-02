/**
 * VinaX AI — one artifact of the gallery, with every version and its content.
 *
 *   GET /api/ai/artifacts/<conversation id>/<artifact id>
 *     → 200 { artifact: { conversationId, conversationTitle, artifactId, versions: [{ messageId, createdAt, type, title, language, content, incomplete }] } }
 *       versions are oldest first, from every branch of the chat.
 *     → 401 signed_out · 404 not_found (missing, deleted or someone else's chat, or no such artifact) · 429 rate_limited · 503 unavailable
 *
 * The router hands both ids as one key, "<conversation id>/<artifact id>".
 */
import { bearer, readSession } from '../../../_lib/googleAuth';
import { CORS, json } from '../../../_lib/authShared';
import { rateLimitAsync } from '../../../_lib/ratelimit';
import { dbConfigured } from '../../../_lib/db';
import { isUuid } from '../../../_lib/ai/store';
import { ARTIFACT_ID, artifactVersions } from '../../../_lib/ai/gallery';
import type { AiEnv } from '../../../_lib/ai/types';

interface Ctx { request: Request; env: AiEnv; params?: { id?: string } }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS' } });

export const onRequestGet = async ({ request, env, params }: Ctx): Promise<Response> => {
  const limited = await rateLimitAsync(request, 'ai-artifact', { capacity: 60, refillPerMinute: 60 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const [conversationId, artifactId, extra] = (params?.id ?? '').split('/');
  if (extra !== undefined || !isUuid(conversationId) || !ARTIFACT_ID.test(artifactId ?? '')) return json({ error: 'not_found' }, 404);
  const r = await artifactVersions(env, sub, conversationId, artifactId);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.value) return json({ error: 'not_found' }, 404);
  return json({ artifact: { conversationId, conversationTitle: r.value.conversationTitle, artifactId, versions: r.value.versions } });
};
