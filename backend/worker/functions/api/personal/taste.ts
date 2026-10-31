/**
 * The account's taste model (Authorization: Bearer <session>).
 *
 *   GET /api/personal/taste      → 200 { summary, mode, eventsSeen, version, updatedAt, hasVector }   what the engine knows, in the listener's own terms
 *                                → 204                                                            nothing learned yet
 *   DELETE /api/personal/taste   → 200 { erased: { events, exposure, pages, taste } }             Erase my taste model
 *   401 signed_out · 503 unavailable
 *
 * The erase does not need the engine switch to be on: a listener may erase
 * after the owner switched the engine off.
 */
import { json } from '../../_lib/authShared';
import { bearer, readSession } from '../../_lib/googleAuth';
import { db, dbConfigured } from '../../_lib/db';
import { rateLimitAsync } from '../../_lib/ratelimit';
import type { PersonalEnv } from '../../_lib/personal/engine';
import { options, personalJson, PERSONAL_CORS } from '../../_lib/personal/route';
import { loadTaste } from '../../_lib/personal/store';

export const onRequestOptions = options('GET, DELETE, OPTIONS');

async function session(env: PersonalEnv, request: Request, route: string): Promise<string | Response> {
  const limited = await rateLimitAsync(request, route, { capacity: 20, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  return sub;
}

export const onRequestGet = async (ctx: { request: Request; env: PersonalEnv }): Promise<Response> => {
  const sub = await session(ctx.env, ctx.request, 'personal-taste');
  if (sub instanceof Response) return sub;
  const loaded = await loadTaste(ctx.env, sub);
  if (!loaded.ok) return json({ error: 'unavailable' }, 503);
  if (loaded.fresh) return new Response(null, { status: 204, headers: PERSONAL_CORS });
  const t = loaded.taste;
  return personalJson({ summary: t.summary, mode: t.mode, eventsSeen: t.eventsSeen, version: t.version, updatedAt: new Date(t.updatedAt).toISOString(), hasVector: !!loaded.embedModel });
};

export const onRequestDelete = async (ctx: { request: Request; env: PersonalEnv }): Promise<Response> => {
  const sub = await session(ctx.env, ctx.request, 'personal-taste-erase');
  if (sub instanceof Response) return sub;
  const r = await db.rpc<Record<string, number>>(ctx.env, 'personal_erase', { p_account: sub });
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return personalJson({ erased: r.value ?? {} });
};
