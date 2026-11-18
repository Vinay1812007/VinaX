/**
 * VinaX AI — the signed-in listener's memory (_lib/ai/memory.ts).
 *
 *   GET    /api/ai/memories → 200 { enabled, prefs: { use, learn }, items: [{ id, text, origin, createdAt }], max }
 *          enabled: false when the owner has turned memory off (the notes can still be seen and deleted)
 *   POST   /api/ai/memories { text } → 201 { item } · 200 { item } when the same note is already there
 *   POST   /api/ai/memories { texts: [string, …] } → 200 { items, added, skipped }   import: one note per line,
 *          the way Claude's Memory page imports; duplicates, sensitive lines and lines past the limit are skipped
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

/** How many notes one import may send (more than memory holds, so a long list still fills it). */
export const IMPORT_MAX = 200;

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  const sub = await memoryGate(ctx, true);
  if (sub instanceof Response) return sub;
  const read = await readJsonCapped<{ text?: unknown; texts?: unknown } | null>(ctx.request, 64_000);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  if (Array.isArray(read.value.texts)) return importMemories(ctx, sub, read.value.texts);
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

/**
 * Import: every line that is a note (cleaned), not a secret, not already
 * there and within the limit becomes a note added by the listener; the rest
 * are counted as skipped. Nothing is replaced.
 */
async function importMemories(ctx: Ctx, sub: string, raw: unknown[]): Promise<Response> {
  if (raw.length > IMPORT_MAX) return json({ error: 'bad_request' }, 400);
  if (!(await memoryAllowed(ctx.env))) return json({ error: 'memory_off' }, 503);
  const have = await listMemories(ctx.env, sub);
  if (!have.ok) return json({ error: 'unavailable' }, 503);
  const keys = new Set(have.rows.map((m) => memoryKey(m.text)));
  let room = Math.max(0, MEMORY_MAX_ITEMS - have.rows.length);
  const now = new Date().toISOString();
  const rows: MemoryRow[] = [];
  let skipped = 0;
  for (const item of raw) {
    const text = cleanMemoryText(item);
    if (!text) continue;
    const key = memoryKey(text);
    if (!key || keys.has(key) || looksSensitive(text) || room <= 0) { skipped += 1; continue; }
    keys.add(key);
    room -= 1;
    rows.push({ id: crypto.randomUUID(), account_id: sub, text, origin: 'user', conversation_id: null, created_at: now, updated_at: now });
  }
  if (!rows.length) return json({ items: [], added: 0, skipped });
  const made = await db.insert<MemoryRow>(ctx.env, 'ai_memories', rows, { returning: true });
  if (!made.ok) return made.code === '23503' ? json({ error: 'signed_out' }, 401) : json({ error: 'unavailable' }, 503);
  const items = (made.rows.length ? made.rows : rows).map(publicMemory);
  return json({ items, added: items.length, skipped });
}

export const onRequestDelete = async (ctx: Ctx): Promise<Response> => {
  const sub = await memoryGate(ctx, true);
  if (sub instanceof Response) return sub;
  const r = await removeAllMemories(ctx.env, sub);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return json({ ok: true, removed: r.rows.length });
};
