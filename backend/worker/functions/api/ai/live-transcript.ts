/**
 * VinaX AI — POST /api/ai/live-transcript: what was said in a Live voice
 * session goes into the chat as ordinary messages, so it shows in the
 * thread, syncs, exports and deletes like any other turn.
 *
 *   { conversationId: uuid | null,        // null = a new chat
 *     parentMessageId?: uuid,              // default: after the chat's active leaf
 *     model: "<live model id>",
 *     turns: [{ role: "user" | "assistant", text,
 *               sources?: [{ url, title }] }] }   // in order, at most 200; sources: what a reply searched
 *
 *   → 200 { conversationId, messageIds: [...] }  (the last one is the new active leaf)
 *   → 400 bad_request · 401 signed_out · 404 not_found · 409 conversation_full · 413 too_large
 *   → 429 rate_limited · 503 ai_disabled | unavailable
 *
 * Consecutive turns by the same speaker are joined. A reply's web sources
 * (http(s) links only, at most 10) are saved like a typed reply's. Nothing
 * is generated here, and the text is not logged.
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured } from '../../_lib/db';
import { aiOpenFor, aiSettings } from '../../_lib/ai/config';
import { fallbackTitle, latestLeaf } from '../../_lib/ai/history';
import { createConversation, getConversation, isUuid, listMessages, MAX_MESSAGES, updateConversation } from '../../_lib/ai/store';
import { ALL_LIVE_MODELS, LIVE_ID_PREFIX } from '../../_lib/ai/voice';
import type { AiEnv, Source } from '../../_lib/ai/types';

export const MAX_TURNS = 200;
export const MAX_TURN_CHARS = 8_000;
export const MAX_TURN_SOURCES = 10;

type CleanTurn = { role: 'user' | 'assistant'; text: string; sources?: Source[] };

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** A reply's sources: http(s) links with a short title, no repeats, numbered from 1. */
export function cleanSources(raw: unknown, into: Source[] = []): Source[] {
  const out = [...into];
  if (!Array.isArray(raw)) return out;
  for (const r of raw.slice(0, 50)) {
    if (out.length >= MAX_TURN_SOURCES) break;
    const url = typeof (r as { url?: unknown })?.url === 'string' ? ((r as { url: string }).url).trim() : '';
    if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 2_000 || out.some((s) => s.url === url)) continue;
    const t = (r as { title?: unknown }).title;
    const title = typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    // Search grounding links redirect; their title is the site's name.
    const site = title.replace(/^www\./, '') || hostOf(url);
    out.push({ n: out.length + 1, url, title: title || site || 'Source', site: site || 'source' });
  }
  return out;
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS' } });

/** Clean turns: known roles, trimmed text, same-speaker runs joined. */
export function cleanTurns(raw: unknown): CleanTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TURNS) return null;
  const out: CleanTurn[] = [];
  for (const t of raw) {
    const role = (t as { role?: unknown })?.role;
    const text = (t as { text?: unknown })?.text;
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string') return null;
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TURN_CHARS);
    if (!clean) continue;
    const found = role === 'assistant' ? (t as { sources?: unknown }).sources : undefined;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.text = `${last.text} ${clean}`.slice(0, MAX_TURN_CHARS);
      if (found !== undefined) last.sources = cleanSources(found, last.sources);
    } else {
      out.push({ role, text: clean });
      if (found !== undefined) out[out.length - 1].sources = cleanSources(found);
    }
  }
  for (const t of out) if (t.sources && !t.sources.length) delete t.sources;
  return out.length ? out : null;
}

export const onRequestPost = async (ctx: { request: Request; env: AiEnv }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'ai-live-transcript', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  if (!aiOpenFor(await aiSettings(env), sub)) return json({ error: 'ai_disabled' }, 503);

  const read = await readJsonCapped<Record<string, unknown> | null>(request, 512 * 1024);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const body = read.value && typeof read.value === 'object' ? read.value : {};
  const turns = cleanTurns(body.turns);
  if (!turns) return json({ error: 'bad_request' }, 400);
  const live = ALL_LIVE_MODELS.find((m) => m.id === body.model);
  if (!live) return json({ error: 'bad_request' }, 400);
  if (body.conversationId != null && !isUuid(body.conversationId)) return json({ error: 'not_found' }, 404);
  if (body.parentMessageId != null && !isUuid(body.parentMessageId)) return json({ error: 'bad_request' }, 400);

  let convId: string;
  let parentId: string | null = null;
  if (body.conversationId) {
    const c = await getConversation(env, sub, body.conversationId);
    if (!c.ok) return json({ error: 'unavailable' }, 503);
    if (!c.value) return json({ error: 'not_found' }, 404);
    const rows = await listMessages(env, c.value.id);
    if (!rows.ok) return json({ error: 'unavailable' }, 503);
    if (rows.rows.length + turns.length > MAX_MESSAGES) return json({ error: 'conversation_full' }, 409);
    if (isUuid(body.parentMessageId)) {
      if (!rows.rows.some((r) => r.id === body.parentMessageId)) return json({ error: 'not_found' }, 404);
      parentId = body.parentMessageId;
    } else {
      const active = c.value.active_leaf_id && rows.rows.some((r) => r.id === c.value?.active_leaf_id) ? c.value.active_leaf_id : null;
      parentId = active ?? latestLeaf(rows.rows)?.id ?? null;
    }
    convId = c.value.id;
  } else {
    const firstUser = turns.find((t) => t.role === 'user')?.text ?? turns[0].text;
    const made = await createConversation(env, { id: crypto.randomUUID(), account_id: sub, title: fallbackTitle(firstUser), model_pref: 'auto' });
    if (!made.ok) return made.code === '23503' ? json({ error: 'signed_out' }, 401) : json({ error: 'unavailable' }, 503);
    if (!made.rows[0]) return json({ error: 'unavailable' }, 503);
    convId = made.rows[0].id;
  }

  // One insert for the whole session (each message hangs on the one before).
  const base = Date.now();
  const rows = turns.map((t, i) => ({
    id: crypto.randomUUID(),
    conversation_id: convId,
    parent_id: null as string | null,
    role: t.role,
    content: [{ type: 'text', text: t.text }],
    sources: t.sources ? { items: t.sources, via: 'grounding', queries: [] } : null,
    model_id: t.role === 'assistant' ? `${LIVE_ID_PREFIX}${live.id}` : null,
    provider: t.role === 'assistant' ? 'gemini' : null,
    stop_reason: t.role === 'assistant' ? 'end' : null,
    created_at: new Date(base + i).toISOString(),
  }));
  rows.forEach((r, i) => { r.parent_id = i === 0 ? parentId : rows[i - 1].id; });
  const saved = await db.insert(env, 'ai_messages', rows, { returning: false });
  if (!saved.ok) return json({ error: 'unavailable' }, 503);
  const leaf = rows[rows.length - 1].id;
  await updateConversation(env, sub, convId, { active_leaf_id: leaf, updated_at: new Date().toISOString() });
  console.log(JSON.stringify({ route: 'ai-live-transcript', model: live.id, turns: rows.length, ok: true }));
  return json({ conversationId: convId, messageIds: rows.map((r) => r.id) });
};
