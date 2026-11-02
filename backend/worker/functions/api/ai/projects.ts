/**
 * VinaX AI — the signed-in listener's projects.
 *
 *   GET  /api/ai/projects → 200 { items: [{ id, name, description, instructions, starred, createdAt, updatedAt, chatCount, fileCount }] }
 *        newest first (starred ones are put first by the page)
 *   POST /api/ai/projects { name, description?, instructions? } → 201 { project }
 *        name ≤ 60 characters, description ≤ 300, instructions ≤ 8,000
 *   → 400 bad_request · 401 signed_out · 409 too_many_projects (100) · 429 rate_limited · 503 unavailable
 *
 * Knowledge files are added with POST /api/ai/attachments?projectId=<id>.
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../_lib/db';
import { listProjects, MAX_PROJECTS, parseProject, publicProject, type ProjectRow } from '../../_lib/ai/projects';
import type { AiEnv } from '../../_lib/ai/types';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, OPTIONS' } });

async function session(request: Request, env: AiEnv, route: string): Promise<string | Response> {
  const limited = await rateLimitAsync(request, route, { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  return sub;
}

/** How many of each project's chats and files there are (one read each, counted here). */
async function countsOf(env: AiEnv, sub: string): Promise<Map<string, { chats: number; files: number }>> {
  const out = new Map<string, { chats: number; files: number }>();
  const [chats, files] = await Promise.all([
    db.select<{ project_id: string | null }>(env, 'ai_conversations', q().eq('account_id', sub).not('project_id', 'is', 'null').is('deleted_at', 'null').select('project_id').limit(5_000)),
    db.select<{ project_id: string | null }>(env, 'ai_attachments', q().eq('account_id', sub).not('project_id', 'is', 'null').select('project_id').limit(5_000)),
  ]);
  const bump = (id: string | null, key: 'chats' | 'files') => {
    if (!id) return;
    const c = out.get(id) ?? { chats: 0, files: 0 };
    c[key] += 1;
    out.set(id, c);
  };
  if (chats.ok) for (const r of chats.rows) bump(r.project_id, 'chats');
  if (files.ok) for (const r of files.rows) bump(r.project_id, 'files');
  return out;
}

export const onRequestGet = async (ctx: { request: Request; env: AiEnv }): Promise<Response> => {
  const sub = await session(ctx.request, ctx.env, 'ai-projects');
  if (sub instanceof Response) return sub;
  const [r, counts] = await Promise.all([listProjects(ctx.env, sub), countsOf(ctx.env, sub)]);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return json({ items: r.rows.map((p) => publicProject(p, counts.get(p.id) ?? { chats: 0, files: 0 })) });
};

export const onRequestPost = async (ctx: { request: Request; env: AiEnv }): Promise<Response> => {
  const sub = await session(ctx.request, ctx.env, 'ai-projects-write');
  if (sub instanceof Response) return sub;
  const read = await readJsonCapped<unknown>(ctx.request, 64_000);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const parsed = parseProject(read.value, true);
  if (!parsed.ok) return json({ error: 'bad_request' }, 400);
  const have = await db.count(ctx.env, 'ai_projects', q().eq('account_id', sub));
  if (!have.ok) return json({ error: 'unavailable' }, 503);
  if (have.value >= MAX_PROJECTS) return json({ error: 'too_many_projects' }, 409);
  const now = new Date().toISOString();
  const row: ProjectRow = {
    id: crypto.randomUUID(), account_id: sub, name: parsed.patch.name!, description: parsed.patch.description ?? null,
    instructions: parsed.patch.instructions ?? null, starred: parsed.patch.starred ?? false, created_at: now, updated_at: now,
  };
  const saved = await db.insert(ctx.env, 'ai_projects', row);
  // 23503: the account row is gone (deleted elsewhere), so the session no longer stands.
  if (!saved.ok) return saved.code === '23503' ? json({ error: 'signed_out' }, 401) : json({ error: 'unavailable' }, 503);
  return json({ project: publicProject(row, { chats: 0, files: 0 }) }, 201);
};
