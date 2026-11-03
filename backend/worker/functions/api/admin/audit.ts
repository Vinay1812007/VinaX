/**
 * GET /api/admin/audit?actor=&action=&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=&offset=
 *   → { configured, total, limit, offset, rows, actors, actions }
 *
 * The Change log: every change an admin made from the console, newest first,
 * with who did it. `actors` and `actions` are the choices the console's
 * Admin and Action dropdowns offer (seen in the newest 1000 rows). Dates are
 * whole days in India's time zone; `to` includes that day.
 */
import { adminJson, dbFailure } from '../../_lib/admin';
import { adminGet, camel, paging } from '../../_lib/adminRoute';
import { db, firstFailure, q, type Query } from '../../_lib/db';
import { clip } from '../../_lib/edge';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** "YYYY-MM-DD" in India → the UTC instant that day starts. */
const istStart = (d: string): string => new Date(Date.parse(`${d}T00:00:00+05:30`)).toISOString();

function filters(url: URL): Query {
  const query = q();
  const action = clip(url.searchParams.get('action'), 40);
  if (action && /^[\w.:/-]+$/.test(action)) query.eq('action', action);
  const actor = clip(url.searchParams.get('actor'), 254);
  if (actor && /^[^\s,()]+$/.test(actor)) query.eq('actor', actor);
  const from = url.searchParams.get('from');
  if (from && DAY.test(from)) query.gte('at', istStart(from));
  const to = url.searchParams.get('to');
  if (to && DAY.test(to)) query.lt('at', new Date(Date.parse(istStart(to)) + 86_400_000).toISOString());
  return query;
}

export const onRequestGet = adminGet(async ({ env, url }) => {
  const { limit, offset } = paging(url, 50, 200);
  const [rows, total, recent] = await Promise.all([
    db.select<Record<string, unknown>>(env, 'audit_log', filters(url).select('*').order('at', 'desc').limit(limit).offset(offset)),
    db.count(env, 'audit_log', filters(url)),
    db.select<{ actor: string; action: string }>(env, 'audit_log', q().select('actor,action').order('at', 'desc').limit(1000)),
  ]);
  const failed = firstFailure(rows, total, recent);
  if (failed) return dbFailure(failed);
  if (!rows.ok || !total.ok || !recent.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);
  const actors = [...new Set(recent.rows.map((r) => r.actor).filter(Boolean))].sort();
  const actions = [...new Set(recent.rows.map((r) => r.action).filter(Boolean))].sort();
  return adminJson({ configured: true, total: total.value, limit, offset, rows: rows.rows.map(camel), actors, actions });
});
