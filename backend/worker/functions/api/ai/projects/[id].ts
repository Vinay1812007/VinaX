/**
 * VinaX AI — one project of the signed-in listener.
 *
 *   GET    /api/ai/projects/<id> → 200 { project, files: [{ id, name, mime, kind, size, pages?, chars, createdAt }],
 *                                       chats: [conversation…] (newest 100), limits: { files, chars, usedChars } }
 *   PATCH  /api/ai/projects/<id> { name?, description?, instructions?, starred? } → 200 { project }
 *   DELETE /api/ai/projects/<id>?chats=keep|delete → 200 { ok: true, chats: n }
 *          The knowledge files always go. Its chats stay as ordinary chats
 *          (keep, the default) or are deleted with it (delete: hidden now,
 *          purged a day later like any deleted chat, their shared links gone now).
 *   → 400 bad_request · 401 signed_out · 404 not_found (missing or someone else's) · 503 unavailable
 *
 * Knowledge files: added with POST /api/ai/attachments?projectId=<id>,
 * removed with DELETE /api/ai/attachments/<file id>.
 */
import { bearer, readSession } from '../../../_lib/googleAuth';
import { CORS, json } from '../../../_lib/authShared';
import { readJsonCapped } from '../../../_lib/body';
import { rateLimitAsync } from '../../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../../_lib/db';
import {
  getProject, MAX_PROJECT_CHARS, MAX_PROJECT_FILES, parseProject, projectFiles, publicKnowledgeFile, publicProject, removeProjectFiles, type ProjectRow,
} from '../../../_lib/ai/projects';
import { isUuid, listConversations, publicConversation } from '../../../_lib/ai/store';
import type { AiEnv } from '../../../_lib/ai/types';

interface Ctx { request: Request; env: AiEnv; params?: { id?: string } }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, PATCH, DELETE, OPTIONS' } });

/** The session's account and its project, or the response to send instead. */
async function owned(ctx: Ctx, route: string): Promise<{ sub: string; project: ProjectRow } | Response> {
  const limited = await rateLimitAsync(ctx.request, route, { capacity: 30, refillPerMinute: 30 }, ctx.env);
  if (limited) return limited;
  const sub = await readSession(ctx.env, bearer(ctx.request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(ctx.env)) return json({ error: 'unavailable' }, 503);
  const id = ctx.params?.id;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const p = await getProject(ctx.env, sub, id);
  if (!p.ok) return json({ error: 'unavailable' }, 503);
  if (!p.value) return json({ error: 'not_found' }, 404);
  return { sub, project: p.value };
}

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const o = await owned(ctx, 'ai-project');
  if (o instanceof Response) return o;
  const [files, chats] = await Promise.all([projectFiles(ctx.env, o.sub, o.project.id), listConversations(ctx.env, o.sub, { projectId: o.project.id, limit: 100 })]);
  if (!files.ok || !chats.ok) return json({ error: 'unavailable' }, 503);
  return json({
    project: publicProject(o.project, { chats: chats.rows.length, files: files.rows.length }),
    files: files.rows.map(publicKnowledgeFile),
    chats: chats.rows.map(publicConversation),
    limits: { files: MAX_PROJECT_FILES, chars: MAX_PROJECT_CHARS, usedChars: files.rows.reduce((n, f) => n + (f.extracted_text?.length ?? 0), 0) },
  });
};

export const onRequestPatch = async (ctx: Ctx): Promise<Response> => {
  const o = await owned(ctx, 'ai-project-write');
  if (o instanceof Response) return o;
  const read = await readJsonCapped<unknown>(ctx.request, 64_000);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const parsed = parseProject(read.value, false);
  if (!parsed.ok || !Object.keys(parsed.patch).length) return json({ error: 'bad_request' }, 400);
  // Starring is not an edit: updated_at stays.
  const edited = Object.keys(parsed.patch).some((k) => k !== 'starred');
  const patch = { ...parsed.patch, ...(edited ? { updated_at: new Date().toISOString() } : {}) };
  const r = await db.update<ProjectRow>(ctx.env, 'ai_projects', q().eq('id', o.project.id).eq('account_id', o.sub), patch, { returning: true });
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.rows[0]) return json({ error: 'not_found' }, 404);
  return json({ project: publicProject(r.rows[0]) });
};

export const onRequestDelete = async (ctx: Ctx): Promise<Response> => {
  const o = await owned(ctx, 'ai-project-write');
  if (o instanceof Response) return o;
  const mode = new URL(ctx.request.url).searchParams.get('chats') ?? 'keep';
  if (mode !== 'keep' && mode !== 'delete') return json({ error: 'bad_request' }, 400);
  let gone = 0;
  if (mode === 'delete') {
    const hidden = await db.update<{ id: string }>(ctx.env, 'ai_conversations', q().eq('account_id', o.sub).eq('project_id', o.project.id).is('deleted_at', 'null').select('id'), { deleted_at: new Date().toISOString() }, { returning: true });
    if (!hidden.ok) return json({ error: 'unavailable' }, 503);
    gone = hidden.rows.length;
    // Their shared links go now (a link to a hidden chat already reads as not found).
    const ids = hidden.rows.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 100) await db.remove(ctx.env, 'ai_shares', q().eq('account_id', o.sub).in('conversation_id', ids.slice(i, i + 100)));
  }
  // The stored bytes first; the rows go with the project (cascade), and the
  // chats it keeps become ordinary chats (set null).
  await removeProjectFiles(ctx.env, o.sub, o.project.id);
  const r = await db.remove(ctx.env, 'ai_projects', q().eq('id', o.project.id).eq('account_id', o.sub));
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return json({ ok: true, chats: gone });
};
