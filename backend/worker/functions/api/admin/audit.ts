/**
 * GET /api/admin/audit?limit=&action= → { configured, rows }
 * The owner's own trail: every change made from the console.
 */
import { adminJson, dbFailure } from '../../_lib/admin';
import { adminGet, camel, paging } from '../../_lib/adminRoute';
import { db, q } from '../../_lib/db';
import { clip } from '../../_lib/edge';

export const onRequestGet = adminGet(async ({ env, url }) => {
  const { limit } = paging(url, 100, 200);
  const query = q().select('*').order('at', 'desc').limit(limit);
  const action = clip(url.searchParams.get('action'), 40);
  if (action && /^[\w.:/-]+$/.test(action)) query.eq('action', action);
  const r = await db.select<Record<string, unknown>>(env, 'audit_log', query);
  if (!r.ok) return dbFailure(r);
  return adminJson({ configured: true, rows: r.rows.map(camel) });
});
