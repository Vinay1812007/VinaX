/**
 * GET  /api/admin/feedback?status=new|read|resolved|all&kind=&limit=&offset=
 *        → { configured, total, counts: { new, read, resolved }, rows }
 * POST /api/admin/feedback { action: 'status', id, status, note? } | { action: 'delete', id } | { action: 'delete_resolved' }
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost, camel, idOf, paging } from '../../_lib/adminRoute';
import { db, q, firstFailure, type Query } from '../../_lib/db';
import { clip } from '../../_lib/edge';

const STATUSES = ['new', 'read', 'resolved'] as const;
type Status = (typeof STATUSES)[number];
const KINDS = ['bug', 'idea', 'content', 'other'] as const;

function filters(url: URL): Query {
  const query = q();
  const status = url.searchParams.get('status') ?? 'new';
  if (status !== 'all' && (STATUSES as readonly string[]).includes(status)) query.eq('status', status);
  const kind = url.searchParams.get('kind');
  if (kind && (KINDS as readonly string[]).includes(kind)) query.eq('kind', kind);
  return query;
}

export const onRequestGet = adminGet(async ({ env, url }) => {
  const { limit, offset } = paging(url, 50, 200);
  const [rows, total, nNew, nRead, nResolved] = await Promise.all([
    db.select<Record<string, unknown>>(env, 'feedback', filters(url).select('*').order('at', 'desc').limit(limit).offset(offset)),
    db.count(env, 'feedback', filters(url)),
    db.count(env, 'feedback', q().eq('status', 'new')),
    db.count(env, 'feedback', q().eq('status', 'read')),
    db.count(env, 'feedback', q().eq('status', 'resolved')),
  ]);
  const failed = firstFailure(rows, total, nNew, nRead, nResolved);
  if (failed) return dbFailure(failed);
  if (!rows.ok || !total.ok || !nNew.ok || !nRead.ok || !nResolved.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);
  return adminJson({
    configured: true,
    total: total.value,
    limit,
    offset,
    counts: { new: nNew.value, read: nRead.value, resolved: nResolved.value },
    rows: rows.rows.map(camel),
  });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  if (body.action === 'status') {
    const id = idOf(body.id);
    const status = body.status as Status;
    if (!id || !STATUSES.includes(status)) return badRequest();
    const patch: Record<string, unknown> = { status, resolved_at: status === 'resolved' ? new Date().toISOString() : null };
    if ('note' in body) patch.note = clip(body.note, 1000);
    const r = await db.update<Record<string, unknown>>(env, 'feedback', q().eq('id', id), patch, { returning: true });
    if (!r.ok) return dbFailure(r);
    if (!r.rows.length) return adminJson({ error: 'not_found' }, 404);
    await audit({ action: 'feedback-status', summary: `feedback #${id} → ${status}`, target: String(id), after: patch });
    return adminJson({ ok: true, row: camel(r.rows[0]) });
  }
  if (body.action === 'delete') {
    const id = idOf(body.id);
    if (!id) return badRequest();
    const r = await db.remove<{ id: number; message: string }>(env, 'feedback', q().eq('id', id).select('id,message'), { returning: true });
    if (!r.ok) return dbFailure(r);
    if (!r.rows.length) return adminJson({ error: 'not_found' }, 404);
    await audit({ action: 'feedback-delete', summary: `deleted feedback #${id}`, target: String(id), before: r.rows[0] });
    return adminJson({ ok: true, deleted: 1 });
  }
  if (body.action === 'delete_resolved') {
    const r = await db.remove<{ id: number }>(env, 'feedback', q().eq('status', 'resolved').select('id'), { returning: true });
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'feedback-delete-resolved', summary: `deleted ${r.rows.length} resolved feedback message${r.rows.length === 1 ? '' : 's'}` });
    return adminJson({ ok: true, deleted: r.rows.length });
  }
  return badRequest('unknown_action');
});
