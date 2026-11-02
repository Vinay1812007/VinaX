/**
 * VinaX AI — the listener's memory switches, kept with the account because
 * learning runs on the server.
 *
 *   GET /api/ai/memories/prefs → 200 { prefs: { use, learn } }   (no row yet = both on)
 *   PUT /api/ai/memories/prefs { use?, learn? } → 200 { prefs }
 *   → 400 bad_request · 401 signed_out · 429 rate_limited · 503 unavailable
 */
import { CORS, json } from '../../../_lib/authShared';
import { readJsonCapped } from '../../../_lib/body';
import { memoryGate, readPrefs, writePrefs } from '../../../_lib/ai/memory';
import type { AiEnv } from '../../../_lib/ai/types';

interface Ctx { request: Request; env: AiEnv }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, PUT, OPTIONS' } });

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const sub = await memoryGate(ctx, false);
  if (sub instanceof Response) return sub;
  const r = await readPrefs(ctx.env, sub);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return json({ prefs: r.value });
};

export const onRequestPut = async (ctx: Ctx): Promise<Response> => {
  const sub = await memoryGate(ctx, true);
  if (sub instanceof Response) return sub;
  const read = await readJsonCapped<Record<string, unknown> | null>(ctx.request, 1_024);
  if (!read.ok || !read.value || typeof read.value !== 'object' || Array.isArray(read.value)) return json({ error: 'bad_request' }, 400);
  const b = read.value;
  const has = (k: string) => k in b;
  if (!has('use') && !has('learn')) return json({ error: 'bad_request' }, 400);
  if ((has('use') && typeof b.use !== 'boolean') || (has('learn') && typeof b.learn !== 'boolean')) return json({ error: 'bad_request' }, 400);
  const now = await readPrefs(ctx.env, sub);
  if (!now.ok) return json({ error: 'unavailable' }, 503);
  const prefs = { use: typeof b.use === 'boolean' ? b.use : now.value.use, learn: typeof b.learn === 'boolean' ? b.learn : now.value.learn };
  const w = await writePrefs(ctx.env, sub, prefs);
  if (!w.ok) return w.code === '23503' ? json({ error: 'signed_out' }, 401) : json({ error: 'unavailable' }, 503);
  return json({ prefs });
};
