/**
 * VinaX AI — one memory note.
 *
 *   DELETE /api/ai/memories/<id> → 200 { ok: true }
 *   → 401 signed_out · 404 not_found (missing or someone else's) · 429 rate_limited · 503 unavailable
 */
import { CORS, json } from '../../../_lib/authShared';
import { isUuid } from '../../../_lib/ai/store';
import { memoryGate, removeMemory } from '../../../_lib/ai/memory';
import type { AiEnv } from '../../../_lib/ai/types';

interface Ctx { request: Request; env: AiEnv; params?: { id?: string } }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'DELETE, OPTIONS' } });

export const onRequestDelete = async (ctx: Ctx): Promise<Response> => {
  const sub = await memoryGate(ctx, true);
  if (sub instanceof Response) return sub;
  const id = ctx.params?.id;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const r = await removeMemory(ctx.env, sub, id);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.rows.length) return json({ error: 'not_found' }, 404);
  return json({ ok: true });
};
