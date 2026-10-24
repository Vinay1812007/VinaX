/**
 * GET  /api/admin/analytics?view=music|geo|engagement|retention|funnel|skips|errors&days=
 *        → { configured, days, view, data }
 * POST /api/admin/analytics { action: 'clear_errors' }
 *
 * Each view is one stats_* function's answer; engagement also carries the
 * daily timeline and the platform split.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { db, q } from '../../_lib/db';
import { daysParam } from '../../_lib/edge';

const VIEWS = ['music', 'geo', 'engagement', 'retention', 'funnel', 'skips', 'errors'] as const;
type View = (typeof VIEWS)[number];

export const onRequestGet = adminGet(async ({ env, url }) => {
  const view = url.searchParams.get('view') as View | null;
  if (!view || !VIEWS.includes(view)) return badRequest('unknown_view', { views: VIEWS });
  const days = daysParam(url, 7, 90);

  if (view === 'engagement') {
    const [eng, timeline, platforms] = await Promise.all([
      db.rpc<Record<string, unknown>>(env, 'stats_engagement', { p_days: days }),
      db.rpc<unknown[]>(env, 'stats_timeline', { p_days: days }),
      db.rpc<Record<string, unknown>>(env, 'stats_platforms'),
    ]);
    if (!eng.ok) return dbFailure(eng);
    if (!timeline.ok) return dbFailure(timeline);
    if (!platforms.ok) return dbFailure(platforms);
    return adminJson({ configured: true, days, view, data: { ...(eng.value ?? {}), timeline: timeline.value ?? [], ...(platforms.value ?? {}) } });
  }

  const call: Record<Exclude<View, 'engagement'>, [string, Record<string, unknown>]> = {
    music: ['stats_music', { p_days: days, p_limit: 50 }],
    geo: ['stats_geo', { p_days: days }],
    retention: ['stats_retention', { p_weeks: Math.min(26, Math.max(8, Math.ceil(days / 7))) }],
    funnel: ['stats_funnel', { p_days: days }],
    skips: ['stats_skips', { p_days: days, p_min: 5 }],
    errors: ['stats_errors', { p_days: days, p_limit: 100 }],
  };
  const [fn, args] = call[view];
  const r = await db.rpc<unknown>(env, fn, args);
  if (!r.ok) return dbFailure(r);
  return adminJson({ configured: true, days, view, data: r.value ?? (view === 'music' || view === 'geo' || view === 'errors' ? {} : []) });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  if (body.action !== 'clear_errors') return badRequest('unknown_action');
  const r = await db.remove<{ id: number }>(env, 'events', q().eq('kind', 'error').select('id'), { returning: true });
  if (!r.ok) return dbFailure(r);
  await audit({ action: 'errors-clear', summary: `cleared ${r.rows.length} app error${r.rows.length === 1 ? '' : 's'}` });
  return adminJson({ ok: true, deleted: r.rows.length });
});
