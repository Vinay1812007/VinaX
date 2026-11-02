/**
 * VinaX AI — the signed-in listener's memory (_lib/ai/memory.ts).
 *
 *   GET    /api/ai/memories → 200 { enabled, prefs: { use, learn }, items: [{ id, text, origin, createdAt }], max }
 *          enabled: false when the owner has turned memory off (the notes can still be seen and deleted)
 *   POST   /api/ai/memories { text } → 201 { item } · 200 { item } when the same note is already there
 *   DELETE /api/ai/memories → 200 { ok: true, removed }   forget everything
 *   → 400 bad_request · 401 signed_out · 409 full · 422 sensitive · 429 rate_limited · 503 unavailable | memory_off
 *
 * Seeing and deleting always work, also while VinaX AI or memory is off.
 */
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { db } from '../../_lib/db';
import {
  cleanMemoryText, listMemories, looksSensitive, MEMORY_MAX_ITEMS, memoryAllowed, memoryGate, memoryKey, publicMemory, readPrefs, removeAllMemories, type MemoryRow,
} from '../../_lib/ai/memory';
import type { AiEnv } from '../../_lib/ai/types';

interface Ctx { request: Request; env: AiEnv }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' } });

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const sub = await memoryGate(ctx, false);
  if (sub instanceof Response) return sub;
  const [items, prefs, enabled] = await Promise.all([listMemories(ctx.env, sub), readPrefs(ctx.env, sub), memoryAllowed(ctx.env)]);
  if (!items.ok || !prefs.ok) return json({ error: 'unavailable' }, 503);
  return json({ enabled, prefs: prefs.value, items: items.rows.map(publicMemory), max: MEMORY_MAX_ITEMS });
};

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  const sub = await memoryGate(ctx, true);
  if (sub instanceof Response) return sub;
  const read = await readJsonCapped<{ text?: unknown } | null>(ctx.request, 2_048);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  const text = cleanMemoryText(read.value.text);
  if (!text) return json({ error: 'bad_request' }, 400);
  if (looksSensitive(text)) return json({ error: 'sensitive' }, 422);
  if (!(await memoryAllowed(ctx.env))) return json({ error: 'memory_off' }, 503);
  const have = await listMemories(ctx.env, sub);
  if (!have.ok) return json({ error: 'unavailable' }, 503);
  const same = have.rows.find((m) => memoryKey(m.text) === memoryKey(text));
  if (same) return json({ item: publicMemory(same) });
  if (have.rows.length >= MEMORY_MAX_ITEMS) return json({ error: 'full' }, 409);
  const now = new Date().toISOString();
  const made = await db.insert<MemoryRow>(ctx.env, 'ai_memories', { id: crypto.randomUUID(), account_id: sub, text, origin: 'user', conversation_id: null, created_at: now, updated_at: now }, { returning: true });
  // 23503: the account row is gone (deleted elsewhere), so the session no longer stands.
  if (!made.ok) return made.code === '23503' ? json({ error: 'signed_out' }, 401) : json({ error: 'unavailable' }, 503);
  if (!made.rows[0]) return json({ error: 'unavailable' }, 503);
  return json({ item: publicMemory(made.rows[0]) }, 201);
};

export const onRequestDelete = async (ctx: Ctx): Promise<Response> => {
  const sub = await memoryGate(ctx, true);
  if (sub instanceof Response) return sub;
  const r = await removeAllMemories(ctx.env, sub);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return json({ ok: true, removed: r.rows.length });
};
