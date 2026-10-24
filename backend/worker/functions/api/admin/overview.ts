/**
 * GET /api/admin/overview → { configured, schema, kpis, timeline, platforms, attention }
 * The console's landing page: the tiles, two weeks of daily activity, the
 * platform split, and what needs the owner's attention.
 */
import { adminJson, dbFailure } from '../../_lib/admin';
import { adminGet } from '../../_lib/adminRoute';
import { db, q, firstFailure } from '../../_lib/db';

interface Kpis {
  activeNow: number; listeners: number; newListeners24h: number; accounts: number; newAccounts7d: number;
  plays24h: number; plays7d: number; errors24h: number; dau: number; wau: number; mau: number;
  feedbackNew: number; pushDevices: number; roomsActive: number; aiCalls24h: number;
}
interface Attention { level: 'bad' | 'warn' | 'info'; text: string; page?: string; tab?: string }
interface MetaRow { key: string; value: { version?: number; appliedAt?: string } }

export const onRequestGet = adminGet(async ({ env }) => {
  const [kpis, timeline, platforms, meta] = await Promise.all([
    db.rpc<Kpis>(env, 'stats_overview'),
    db.rpc<unknown[]>(env, 'stats_timeline', { p_days: 14 }),
    db.rpc<{ platforms: unknown[]; versions: unknown[] }>(env, 'stats_platforms'),
    db.select<MetaRow>(env, 'meta', q().eq('key', 'schema').select('key,value').limit(1)),
  ]);
  const failed = firstFailure(kpis, timeline, platforms, meta);
  if (failed) return dbFailure(failed);
  if (!kpis.ok || !timeline.ok || !platforms.ok || !meta.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);

  const schema = meta.rows[0]?.value ? { version: meta.rows[0].value.version ?? null, appliedAt: meta.rows[0].value.appliedAt ?? null } : null;
  const k = kpis.value ?? ({} as Kpis);
  const attention: Attention[] = [];
  if (!schema) attention.push({ level: 'bad', text: 'The database has no schema version row — run backend/supabase/schema.sql.', page: 'database' });
  if ((k.errors24h ?? 0) > 20) attention.push({ level: 'bad', text: `${k.errors24h} app errors in the last 24 hours.`, page: 'health', tab: 'errors' });
  else if ((k.errors24h ?? 0) > 0) attention.push({ level: 'info', text: `${k.errors24h} app error${k.errors24h === 1 ? '' : 's'} in the last 24 hours.`, page: 'health', tab: 'errors' });
  if ((k.feedbackNew ?? 0) > 0) attention.push({ level: 'warn', text: `${k.feedbackNew} new feedback message${k.feedbackNew === 1 ? '' : 's'} waiting.`, page: 'feedback' });
  if ((k.pushDevices ?? 0) === 0) attention.push({ level: 'warn', text: 'No device is registered for push notifications yet.', page: 'notify', tab: 'audience' });
  if ((k.roomsActive ?? 0) > 0) attention.push({ level: 'info', text: `${k.roomsActive} Listen Together room${k.roomsActive === 1 ? '' : 's'} active right now.`, page: 'live', tab: 'rooms' });

  return adminJson({
    configured: true,
    schema,
    kpis: k,
    timeline: Array.isArray(timeline.value) ? timeline.value : [],
    platforms: Array.isArray(platforms.value?.platforms) ? platforms.value.platforms : [],
    versions: Array.isArray(platforms.value?.versions) ? platforms.value.versions : [],
    attention,
    checkedAt: new Date().toISOString(),
  });
});
