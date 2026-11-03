/**
 * GET  /api/admin/notifications?status=all|sent|scheduled|draft&limit=
 *        → { configured, rows, counts: { sent, scheduled, draft } }
 *        Everything sent, waiting or drafted, with its delivery receipt and how
 *        many people tapped it.
 * POST /api/admin/notifications
 *        { action: 'retract', id }   take a sent one back (and the announcement it published)
 *        { action: 'cancel', id }    stop a scheduled one before it goes
 *        { action: 'delete', id }    delete a draft or a cancelled one
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost, idOf, paging } from '../../_lib/adminRoute';
import { db, q, firstFailure } from '../../_lib/db';
import { setting, writeSetting } from '../../_lib/settings';

interface Row {
  id: number; at: string; kind: string; title: string; body: string; link: string; audience: Record<string, unknown> | null;
  web_total: number; web_sent: number; web_gone: number; fcm_total: number; fcm_sent: number; failures: unknown; dedupe_key: string | null;
  sent_by: string; retracted_at: string | null; status?: string | null; scheduled_for?: string | null; image?: string | null; opened?: number | null; created_by?: string | null;
}

const STATUSES = ['sent', 'scheduled', 'draft', 'cancelled', 'sending'] as const;

export const shape = (r: Row) => {
  const delivered = (Number(r.web_sent) || 0) + (Number(r.fcm_sent) || 0);
  const opened = Number(r.opened) || 0;
  const status = r.retracted_at ? 'retracted' : r.status ?? 'sent';
  return {
    id: r.id, at: r.at, kind: r.kind, title: r.title, body: r.body, link: r.link, image: r.image ?? null,
    status, scheduledFor: r.scheduled_for ?? null,
    audience: typeof r.audience?.label === 'string' ? r.audience.label : 'Everyone', filter: r.audience ?? {},
    web: { total: r.web_total, sent: r.web_sent, gone: r.web_gone },
    fcm: { total: r.fcm_total, sent: r.fcm_sent },
    delivered, opened, openRate: delivered ? Math.round((opened / delivered) * 1000) / 10 : null,
    failures: r.failures ?? null, sentBy: r.sent_by, createdBy: r.created_by ?? r.sent_by, retractedAt: r.retracted_at,
  };
};

export const onRequestGet = adminGet(async ({ env, url }) => {
  const { limit } = paging(url, 50, 200);
  const status = url.searchParams.get('status') ?? 'all';
  const query = q().select('*').order('at', 'desc').limit(limit);
  if ((STATUSES as readonly string[]).includes(status)) query.eq('status', status);
  const [r, nSent, nSched, nDraft] = await Promise.all([
    db.select<Row>(env, 'notifications', query),
    db.count(env, 'notifications', q().eq('status', 'sent')),
    db.count(env, 'notifications', q().eq('status', 'scheduled')),
    db.count(env, 'notifications', q().eq('status', 'draft')),
  ]);
  const failed = firstFailure(r, nSent, nSched, nDraft);
  if (failed) return dbFailure(failed);
  if (!r.ok || !nSent.ok || !nSched.ok || !nDraft.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);
  return adminJson({ configured: true, rows: r.rows.map(shape), counts: { sent: nSent.value, scheduled: nSched.value, draft: nDraft.value } });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  const id = idOf(body.id);
  if (!id) return badRequest();

  if (body.action === 'cancel') {
    const r = await db.update<Row>(env, 'notifications', q().eq('id', id).eq('status', 'scheduled'), { status: 'cancelled' }, { returning: true });
    if (!r.ok) return dbFailure(r);
    if (!r.rows.length) return adminJson({ error: 'not_found', message: 'It was already sent or cancelled.' }, 404);
    await audit({ action: 'push-cancel', summary: `cancelled scheduled "${r.rows[0].title.slice(0, 60)}"`, target: String(id) });
    return adminJson({ ok: true, id, status: 'cancelled' });
  }

  if (body.action === 'delete') {
    const r = await db.remove<Row>(env, 'notifications', q().eq('id', id).in('status', ['draft', 'cancelled', 'failed']), { returning: true });
    if (!r.ok) return dbFailure(r);
    if (!r.rows.length) return adminJson({ error: 'not_found', message: 'Only drafts, cancelled notifications and ones that did not finish sending can be deleted.' }, 404);
    await audit({ action: 'push-delete', summary: `deleted ${r.rows[0].status ?? 'draft'} "${r.rows[0].title.slice(0, 60)}"`, target: String(id) });
    return adminJson({ ok: true, deleted: 1 });
  }

  if (body.action !== 'retract') return badRequest('unknown_action');
  const r = await db.update<Row>(env, 'notifications', q().eq('id', id).is('retracted_at', 'null'), { retracted_at: new Date().toISOString() }, { returning: true });
  if (!r.ok) return dbFailure(r);
  if (!r.rows.length) return adminJson({ error: 'not_found' }, 404);
  const row = r.rows[0];
  const ts = typeof row.audience?.ts === 'number' ? row.audience.ts : null;
  const current = await setting<{ ts?: unknown }>(env, 'announcement');
  let announcementCleared = false;
  if (ts !== null && current && current.ts === ts) {
    const w = await writeSetting(env, 'announcement', null, 'owner');
    announcementCleared = w.ok;
  }
  await audit({ action: 'push-retract', summary: `retracted "${row.title.slice(0, 60)}"`, target: String(id), before: { title: row.title, body: row.body, at: row.at }, after: { retracted: true, announcementCleared } });
  return adminJson({ ok: true, id, announcementCleared });
});
