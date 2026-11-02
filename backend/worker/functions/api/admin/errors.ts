/**
 * Console rebuild — App Health → App Errors.
 *
 * GET  /api/admin/errors?days=1..90 → { configured, days, total, groups, users, byDay, top }
 *        Every app error report in the window (all devices count — a bug is a
 *        bug), grouped by kind and message shape (song names, ids and numbers
 *        taken out), each group with a fingerprint, people affected (signed-in
 *        users), variants, platforms, versions and the owner's status.
 * POST /api/admin/errors
 *        { action: 'status', fingerprint, status: new|investigating|fixed|ignored, note? }  (editor)
 *        { action: 'clear' }   delete every error report; plays stay (owner)
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { db, q } from '../../_lib/db';
import { clip, daysParam } from '../../_lib/edge';

export const ERROR_STATUSES = ['new', 'investigating', 'fixed', 'ignored'] as const;
type ErrorStatus = (typeof ERROR_STATUSES)[number];

export const onRequestGet = adminGet(async ({ env, url }) => {
  const days = daysParam(url, 7, 90);
  const r = await db.rpc<Record<string, unknown>>(env, 'stats_errors', { p_days: days, p_limit: 300 });
  if (!r.ok) return dbFailure(r);
  const v = r.value ?? {};
  return adminJson({
    configured: true,
    days,
    total: Number(v.total) || 0,
    groups: Number(v.groups) || 0,
    users: Number(v.users) || 0,
    byDay: Array.isArray(v.byDay) ? v.byDay : [],
    top: Array.isArray(v.top) ? v.top : [],
  });
});

export const onRequestPost = adminPost(async ({ env, body, audit, me }) => {
  if (body.action === 'status') {
    const fingerprint = typeof body.fingerprint === 'string' && /^[0-9a-f]{32}$/.test(body.fingerprint) ? body.fingerprint : null;
    const status = body.status as ErrorStatus;
    if (!fingerprint || !ERROR_STATUSES.includes(status)) return badRequest();
    const row: Record<string, unknown> = { fingerprint, status, updated_at: new Date().toISOString(), updated_by: me.email };
    if ('note' in body) row.note = clip(body.note, 500);
    const w = await db.upsert(env, 'error_status', row, 'fingerprint', { returning: true });
    if (!w.ok) return dbFailure(w);
    await audit({ action: 'error-status', summary: `marked an app error as ${status}`, target: fingerprint, after: { status } });
    return adminJson({ ok: true, fingerprint, status });
  }
  if (body.action === 'clear') {
    const r = await db.remove<{ id: number }>(env, 'events', q().eq('kind', 'error').select('id'), { returning: true });
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'errors-clear', summary: `cleared ${r.rows.length} app error report${r.rows.length === 1 ? '' : 's'}` });
    return adminJson({ ok: true, deleted: r.rows.length });
  }
  return badRequest('unknown_action');
}, { role: (b) => (b.action === 'clear' ? 'owner' : 'editor') });
