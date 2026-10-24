/**
 * 15.0 — /api/share-chat — share a VinaX AI conversation at a link.
 *
 *   POST /api/share-chat { title?, messages: [{ role: 'user'|'assistant', content }] }
 *        → 200 { id, url, expiresAt }      kept 90 days, read-only
 *        400 bad_request · 413 too_large
 *   GET  /api/share-chat                → 200 { chats: [{ id, title, createdAt, expiresAt }] }   the caller's shares
 *   DELETE /api/share-chat?id=…         → 204
 *   401 signed_out · 503 unavailable
 *
 * Only what the listener chose to share lands here — chats otherwise stay on
 * the device (schema.sql header). Images and attachments are not shared:
 * the copy holds text only. Readers fetch /api/share-chat/<id>.
 */
import { CORS, json } from '../_lib/authShared';
import { readJsonCapped } from '../_lib/body';
import { rateLimitAsync } from '../_lib/ratelimit';
import { db, q } from '../_lib/db';
import { asObject, clip } from '../_lib/edge';
import { MAX_CHAT_BYTES, newId, requireAccount, type SocialEnv } from '../_lib/social';

export const MAX_SHARED_CHATS = 100;

export interface SharedChatRow { id: string; owner_id: string; title: string | null; payload: { messages: Array<{ role: string; content: string }>; model?: string | null }; bytes: number; created_at: string; expires_at: string }

export function cleanMessages(raw: unknown): Array<{ role: 'user' | 'assistant'; content: string }> | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of raw.slice(0, 200)) {
    const o = asObject(m);
    const role = o?.role === 'user' || o?.role === 'assistant' ? o.role : null;
    const content = typeof o?.content === 'string' ? o.content.slice(0, 40_000) : null;
    if (role && content && content.trim()) out.push({ role, content });
  }
  return out.length ? out : null;
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' } });

export const onRequestGet = async (ctx: { request: Request; env: SocialEnv }): Promise<Response> => {
  const who = await requireAccount(ctx.env, ctx.request);
  if ('fail' in who) return who.fail;
  const r = await db.select<SharedChatRow>(ctx.env, 'shared_chats', q().eq('owner_id', who.sub).select('id,title,created_at,expires_at').order('created_at', 'desc').limit(100));
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return json({ chats: r.rows.map((c) => ({ id: c.id, title: c.title, createdAt: c.created_at, expiresAt: c.expires_at })) });
};

export const onRequestPost = async (ctx: { request: Request; env: SocialEnv }): Promise<Response> => {
  const limited = await rateLimitAsync(ctx.request, 'share-chat', { capacity: 20, refillPerMinute: 10 }, ctx.env);
  if (limited) return limited;
  const who = await requireAccount(ctx.env, ctx.request);
  if ('fail' in who) return who.fail;
  const read = await readJsonCapped<unknown>(ctx.request, MAX_CHAT_BYTES + 8_192);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const body = asObject(read.value);
  const messages = cleanMessages(body?.messages);
  if (!messages) return json({ error: 'bad_request' }, 400);
  // At most MAX_SHARED_CHATS live shares per account; the oldest must go first.
  const live = await db.count(ctx.env, 'shared_chats', q().eq('owner_id', who.sub));
  if (!live.ok) return json({ error: 'unavailable' }, 503);
  if (live.value >= MAX_SHARED_CHATS) return json({ error: 'too_many' }, 409);
  const payload = { messages, model: clip(body?.model, 80) };
  const bytes = JSON.stringify(payload).length;
  if (bytes > MAX_CHAT_BYTES) return json({ error: 'too_large' }, 413);
  const now = Date.now();
  const row: SharedChatRow = { id: newId(), owner_id: who.sub, title: clip(body?.title, 120), payload, bytes, created_at: new Date(now).toISOString(), expires_at: new Date(now + 90 * 86_400_000).toISOString() };
  const made = await db.insert<SharedChatRow>(ctx.env, 'shared_chats', row, { returning: true });
  if (!made.ok) return json({ error: made.code === '23503' ? 'signed_out' : 'unavailable' }, made.code === '23503' ? 401 : 503);
  const origin = new URL(ctx.request.url).origin;
  return json({ id: row.id, url: `${origin}/ai/shared/${row.id}`, expiresAt: row.expires_at });
};

export const onRequestDelete = async (ctx: { request: Request; env: SocialEnv }): Promise<Response> => {
  const who = await requireAccount(ctx.env, ctx.request);
  if ('fail' in who) return who.fail;
  const id = new URL(ctx.request.url).searchParams.get('id') ?? '';
  if (!/^[a-z0-9]{12}$/.test(id)) return json({ error: 'bad_request' }, 400);
  const r = await db.remove(ctx.env, 'shared_chats', q().eq('id', id).eq('owner_id', who.sub));
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return new Response(null, { status: 204, headers: CORS });
};
