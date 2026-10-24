/**
 * GET  /api/admin/notifications?limit= → { configured, rows }
 * POST /api/admin/notifications { action: 'retract', id }
 *
 * Everything that was sent, with its delivery receipt. Retracting marks the
 * row and, when it was the current announcement, takes the announcement down
 * so Android devices that have not opened the app yet never see it.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost, idOf, paging } from '../../_lib/adminRoute';
import { db, q } from '../../_lib/db';
import { setting, writeSetting } from '../../_lib/settings';

interface Row {
  id: number; at: string; kind: string; title: string; body: string; link: string; audience: Record<string, unknown> | null;
  web_total: number; web_sent: number; web_gone: number; fcm_total: number; fcm_sent: number; failures: unknown; dedupe_key: string | null; sent_by: string; retracted_at: string | null;
}

const shape = (r: Row) => ({
  id: r.id, at: r.at, kind: r.kind, title: r.title, body: r.body, link: r.link,
  audience: r.audience?.label ?? 'everyone', filter: r.audience ?? {},
  web: { total: r.web_total, sent: r.web_sent, gone: r.web_gone },
  fcm: { total: r.fcm_total, sent: r.fcm_sent },
  failures: r.failures ?? null, sentBy: r.sent_by, retractedAt: r.retracted_at,
});

export const onRequestGet = adminGet(async ({ env, url }) => {
  const { limit } = paging(url, 50, 100);
  const r = await db.select<Row>(env, 'notifications', q().select('*').order('at', 'desc').limit(limit));
  if (!r.ok) return dbFailure(r);
  return adminJson({ configured: true, rows: r.rows.map(shape) });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  if (body.action !== 'retract') return badRequest('unknown_action');
  const id = idOf(body.id);
  if (!id) return badRequest();
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
