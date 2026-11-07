/**
 * GET  /api/admin/analytics?view=music|rising|geo|engagement|listening|retention|funnel|skips|errors|devices&days=
 *        → { configured, days, view, data }
 * POST /api/admin/analytics { action: 'clear_errors' }   (owner only)
 *
 * Song Stats. Since schema 10 every view counts signed-in users only (plays,
 * people), except `funnel` (aggregate sign-up journey) and `errors`.
 *   music / rising → { songs [{ id, title, artist, image, plays, listeners, prev_plays }], artists, languages, rising }
 *   geo            → { countries, regions, cities }
 *   engagement     → { byKind, byPlatform, hourly, perUser, segments, total, timeline, platforms, versions,
 *                      listening (schema 14: stats_listening, null on an older database) }
 *   listening      → { since, total, people, perPerson, perPersonDay, hourly { cells, byHour, peak },
 *                      timeline [{ day, seconds, people }], buckets }   (seconds; schema 14)
 *   retention      → [{ week, size, d1, d7, d30, d1Of, d7Of, d30Of }]   (d*Of from schema 14:
 *                      people whose window is over; cohorts are sign-in weeks)
 *   funnel         → [{ id, label, listeners }] (4 steps)
 *   skips          → [{ id, title, artist, image, plays, skips, rate }]
 *   devices        → { days, devices, display: { app, installed, tab, unknown }, brands, models,
 *                      android, ios, browsers, androidKnown, androidAll, modelKnown }   (schema 16)
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { db, q } from '../../_lib/db';
import { daysParam } from '../../_lib/edge';

const VIEWS = ['music', 'rising', 'geo', 'engagement', 'listening', 'retention', 'funnel', 'skips', 'errors', 'devices'] as const;
type View = (typeof VIEWS)[number];

export const onRequestGet = adminGet(async ({ env, url }) => {
  const view = url.searchParams.get('view') as View | null;
  if (!view || !VIEWS.includes(view)) return badRequest('unknown_view', { views: VIEWS });
  const days = daysParam(url, 7, 90);

  if (view === 'engagement') {
    const [eng, timeline, platforms, listening] = await Promise.all([
      db.rpc<Record<string, unknown>>(env, 'stats_engagement', { p_days: days }),
      db.rpc<unknown[]>(env, 'stats_timeline', { p_days: days }),
      db.rpc<Record<string, unknown>>(env, 'stats_platforms'),
      db.rpc<Record<string, unknown>>(env, 'stats_listening', { p_days: days }),
    ]);
    if (!eng.ok) return dbFailure(eng);
    if (!timeline.ok) return dbFailure(timeline);
    if (!platforms.ok) return dbFailure(platforms);
    // Listening time needs schema 14; on an older database the page shows plays only.
    return adminJson({ configured: true, days, view, data: { ...(eng.value ?? {}), timeline: timeline.value ?? [], ...(platforms.value ?? {}), listening: listening.ok && listening.value && typeof listening.value === 'object' && !Array.isArray(listening.value) ? listening.value : null } });
  }

  const call: Record<Exclude<View, 'engagement'>, [string, Record<string, unknown>]> = {
    music: ['stats_music', { p_days: days, p_limit: 100 }],
    listening: ['stats_listening', { p_days: days }],
    rising: ['stats_music', { p_days: days, p_limit: 100 }],
    geo: ['stats_geo', { p_days: days }],
    retention: ['stats_retention', { p_weeks: Math.min(26, Math.max(8, Math.ceil(days / 7))) }],
    funnel: ['stats_funnel', { p_days: days }],
    skips: ['stats_skips', { p_days: days, p_min: 5 }],
    errors: ['stats_errors', { p_days: days, p_limit: 100 }],
    devices: ['device_breakdown', { p_days: days }],
  };
  const [fn, args] = call[view];
  const r = await db.rpc<unknown>(env, fn, args);
  if (!r.ok) return dbFailure(r);
  return adminJson({ configured: true, days, view, data: r.value ?? (view === 'music' || view === 'rising' || view === 'geo' || view === 'errors' || view === 'listening' || view === 'devices' ? {} : []) });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  if (body.action !== 'clear_errors') return badRequest('unknown_action');
  const r = await db.remove<{ id: number }>(env, 'events', q().eq('kind', 'error').select('id'), { returning: true });
  if (!r.ok) return dbFailure(r);
  await audit({ action: 'errors-clear', summary: `cleared ${r.rows.length} app error${r.rows.length === 1 ? '' : 's'}` });
  return adminJson({ ok: true, deleted: r.rows.length });
}, { role: (b) => (b.action === 'clear_errors' ? 'owner' : 'editor') });
