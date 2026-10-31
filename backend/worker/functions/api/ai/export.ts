/**
 * VinaX AI — GET /api/ai/export: every chat of the signed-in listener with
 * all its messages (every branch), as one JSON file to download.
 *
 *   → 200 { format: "vinax-ai-chats", version: 1, exportedAt, conversations: [{ id, title, starred,
 *           createdAt, updatedAt, activeLeafId, messages: [{ id, parentId, role, content, thinking,
 *           model, stopReason, createdAt }] }] }   (content-disposition: attachment)
 *   → 401 signed_out · 503 unavailable
 *
 * Deleted chats are left out. The file is for the listener to keep; it is
 * not part of the app's backup and is never imported.
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { dbConfigured } from '../../_lib/db';
import { exportChats } from '../../_lib/ai/store';
import type { AiEnv } from '../../_lib/ai/types';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS' } });

export const onRequestGet = async (ctx: { request: Request; env: AiEnv }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'ai-export', { capacity: 3, refillPerMinute: 2 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const r = await exportChats(env, sub);
  if (!r.ok || !r.value || typeof r.value !== 'object') return json({ error: 'unavailable' }, 503);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(r.value), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="vinax-ai-chats-${day}.json"`, ...CORS },
  });
};
