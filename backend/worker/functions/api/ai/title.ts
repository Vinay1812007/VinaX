/**
 * 12.0 — POST /api/ai/title { text } → { title } — a 2–5 word name for a new
 * VinaX AI chat ("BMW meaning explained"), asked by the page once the chat's
 * first reply has finished. Only the first message's text is sent (≤ 500
 * characters, attached files cut off); nothing is stored. { title: null } when
 * no model could help — the page keeps the title it already has.
 */
import { aiGate } from '../../_lib/ai';
import { readJsonCapped } from '../../_lib/body';
import { makeTitle } from '../../_lib/chatExtras';
import { methodNotAllowed, rateLimitAsync } from '../../_lib/ratelimit';
import type { AiEnv } from '../../_lib/ai';

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const onRequestPost = async (context: { request: Request; env: AiEnv & Record<string, unknown> }): Promise<Response> => {
  const { request, env } = context;
  const limited = await rateLimitAsync(request, 'ai-title', { capacity: 10, refillPerMinute: 5 }, env);
  if (limited) return limited;
  const read = await readJsonCapped<{ text?: unknown } | null>(request, 8_000);
  if (!read.ok || !read.value || typeof read.value.text !== 'string' || !read.value.text.trim()) return json({ error: 'bad_request' }, 400);
  if (await aiGate(env, 'vinaxai')) return json({ title: null });
  return json({ title: await makeTitle(env, read.value.text) });
};

export const onRequestGet = async (): Promise<Response> => methodNotAllowed();
