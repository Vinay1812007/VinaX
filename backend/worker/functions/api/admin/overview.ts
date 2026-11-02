/**
 * GET /api/admin/overview?days=1..90 → { configured, schema, kpis, timeline, platforms, versions, attention, checkedAt }
 *
 * The Dashboard. Console rebuild: every people number counts Google signed-in
 * users only (stats_overview / stats_timeline / stats_platforms). `days`
 * sets the timeline length (default 14). `attention` is a list of plain
 * alerts: { id, level: bad|warn|info, text, action, page, tab?, params? }.
 */
import { adminJson, dbFailure } from '../../_lib/admin';
import { adminGet } from '../../_lib/adminRoute';
import { db, q, firstFailure } from '../../_lib/db';
import { intIn } from '../../_lib/edge';

/** The schema.sql version this console is written against. */
const SCHEMA_WANTED = 9;

interface Kpis {
  activeNow?: number; playingNow?: number; users?: number; listeners?: number; accounts?: number; newListeners24h?: number;
  newAccounts7d?: number; newAccountsPrev7d?: number; playsToday?: number; playsYesterday?: number; plays24h?: number; plays7d?: number;
  errors24h?: number; errorsPrev24h?: number; dau?: number; wau?: number; mau?: number; feedbackNew?: number;
  pushDevices?: number; pushPeople?: number; roomsActive?: number;
}
export interface Attention { id: string; level: 'bad' | 'warn' | 'info'; text: string; action: string; page: string; tab?: string; params?: Record<string, string> }
interface MetaRow { key: string; value: { version?: number; appliedAt?: string } }

const n = (v: unknown): number => Number(v) || 0;
const plural = (x: number, one: string, many = `${one}s`): string => `${x.toLocaleString('en-IN')} ${x === 1 ? one : many}`;

/** What the owner should look at, most urgent first. Exported for tests. */
export function attentionFor(k: Kpis, schema: { version: number | null } | null): Attention[] {
  const out: Attention[] = [];
  if (!schema) out.push({ id: 'schema-missing', level: 'bad', text: 'The database has not been set up yet. Nothing can be saved until it is.', action: 'Set up', page: 'database', tab: 'maintenance' });
  else if ((schema.version ?? 0) < SCHEMA_WANTED) out.push({ id: 'schema-old', level: 'warn', text: 'The database needs a one-time update. Until then some numbers may be off.', action: 'How to update', page: 'database', tab: 'maintenance' });
  const errors = n(k.errors24h);
  if (errors > 0) {
    const rising = errors >= 10 && errors > 2 * n(k.errorsPrev24h);
    out.push({ id: 'errors', level: errors > 20 || rising ? 'bad' : 'warn', text: `${plural(errors, 'app error')} in the last 24 hours${rising ? ' — more than double the day before' : ''}.`, action: 'View errors', page: 'health', tab: 'errors' });
  }
  if (n(k.feedbackNew) > 0) out.push({ id: 'feedback', level: 'warn', text: `${plural(n(k.feedbackNew), 'new feedback message')} waiting to be read.`, action: 'Read feedback', page: 'feedback', tab: 'new' });
  if (n(k.pushDevices) === 0) out.push({ id: 'push', level: 'warn', text: 'No phones are set up for notifications yet.', action: 'Set up', page: 'notifications', tab: 'setup' });
  if (n(k.roomsActive) > 0) out.push({ id: 'rooms', level: 'info', text: `${plural(n(k.roomsActive), 'Listen Together room')} open right now.`, action: 'See rooms', page: 'live', tab: 'rooms' });
  return out;
}

export const onRequestGet = adminGet(async ({ env, url }) => {
  const days = intIn(url.searchParams.get('days'), 1, 90) ?? 14;
  const [kpis, timeline, platforms, meta] = await Promise.all([
    db.rpc<Kpis>(env, 'stats_overview'),
    db.rpc<unknown[]>(env, 'stats_timeline', { p_days: days }),
    db.rpc<{ platforms: unknown[]; versions: unknown[] }>(env, 'stats_platforms'),
    db.select<MetaRow>(env, 'meta', q().eq('key', 'schema').select('key,value').limit(1)),
  ]);
  const failed = firstFailure(kpis, timeline, platforms, meta);
  if (failed) return dbFailure(failed);
  if (!kpis.ok || !timeline.ok || !platforms.ok || !meta.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);

  const schema = meta.rows[0]?.value ? { version: meta.rows[0].value.version ?? null, appliedAt: meta.rows[0].value.appliedAt ?? null } : null;
  const k = kpis.value ?? {};
  return adminJson({
    configured: true,
    schema,
    days,
    kpis: k,
    timeline: Array.isArray(timeline.value) ? timeline.value : [],
    platforms: Array.isArray(platforms.value?.platforms) ? platforms.value.platforms : [],
    versions: Array.isArray(platforms.value?.versions) ? platforms.value.versions : [],
    attention: attentionFor(k, schema),
    checkedAt: new Date().toISOString(),
  });
});
