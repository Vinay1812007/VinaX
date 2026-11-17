/**
 * GET /api/admin/overview?days=1..90 → { configured, schema, kpis, timeline, platforms, versions, attention, checkedAt }
 *
 * The Dashboard. Console rebuild: every people number counts Google signed-in
 * users only (stats_overview / stats_timeline / stats_platforms). `days`
 * sets the timeline length (default 14). `attention` is a list of plain
 * alerts: { id, level: bad|warn|info, text, action, page, tab?, params? },
 * where `page` is a console page id of today (`#/<page>?<params>`), not an
 * old address. With the request meter set up (_lib/cfAnalytics.ts), it also
 * warns when today's Worker requests pass 80% of the daily allowance.
 */
import { adminJson, dbFailure } from '../../_lib/admin';
import { adminGet } from '../../_lib/adminRoute';
import { db, q, firstFailure } from '../../_lib/db';
import { intIn } from '../../_lib/edge';
import { analyticsConfigured, readRequestUsage, REQUESTS_BAD_SHARE, REQUESTS_WARN_SHARE, type CfAnalyticsEnv } from '../../_lib/cfAnalytics';
import { SCHEMA_WANTED } from './session';

/** The schema.sql version this console is written against. */

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

/** The Dashboard waits at most this long for Cloudflare (the answer is cached ten minutes). */
const METER_WAIT_MS = 4_000;

/** What the owner should look at, most urgent first. Exported for tests. */
export function attentionFor(k: Kpis, schema: { version: number | null } | null, requests: { used: number; allowance: number } | null = null): Attention[] {
  const out: Attention[] = [];
  if (!schema) out.push({ id: 'schema-missing', level: 'bad', text: 'The database has not been set up yet. Nothing can be saved until it is.', action: 'Set up', page: 'db-maintenance' });
  else if ((schema.version ?? 0) < SCHEMA_WANTED) out.push({ id: 'schema-old', level: 'warn', text: 'The database needs a one-time update. Until then some numbers may be off.', action: 'How to update', page: 'db-maintenance' });
  if (requests && requests.allowance > 0 && requests.used / requests.allowance >= REQUESTS_WARN_SHARE) {
    const share = requests.used / requests.allowance;
    const pct = Math.floor(share * 100);
    out.push({ id: 'requests', level: share >= REQUESTS_BAD_SHARE ? 'bad' : 'warn', text: `${pct}% of today's ${requests.allowance.toLocaleString('en-IN')} server requests are used. At 100% the app stops working until 05:30 India time.`, action: 'See requests', page: 'server-checks' });
  }
  const errors = n(k.errors24h);
  if (errors > 0) {
    const rising = errors >= 10 && errors > 2 * n(k.errorsPrev24h);
    out.push({ id: 'errors', level: errors > 20 || rising ? 'bad' : 'warn', text: `${plural(errors, 'app error')} in the last 24 hours${rising ? ' — more than double the day before' : ''}.`, action: 'View errors', page: 'app-errors' });
  }
  if (n(k.feedbackNew) > 0) out.push({ id: 'feedback', level: 'warn', text: `${plural(n(k.feedbackNew), 'new feedback message')} waiting to be read.`, action: 'Read feedback', page: 'feedback', params: { status: 'new' } });
  if (n(k.pushDevices) === 0) out.push({ id: 'push', level: 'warn', text: 'No phones are set up for notifications yet.', action: 'Set up', page: 'notification-setup' });
  if (n(k.roomsActive) > 0) out.push({ id: 'rooms', level: 'info', text: `${plural(n(k.roomsActive), 'Listen Together room')} open right now.`, action: 'See rooms', page: 'listen-together' });
  return out;
}

export const onRequestGet = adminGet(async ({ env, url }) => {
  const days = intIn(url.searchParams.get('days'), 1, 90) ?? 14;
  const [kpis, timeline, platforms, meta, meter] = await Promise.all([
    db.rpc<Kpis>(env, 'stats_overview'),
    db.rpc<unknown[]>(env, 'stats_timeline', { p_days: days }),
    db.rpc<{ platforms: unknown[]; versions: unknown[] }>(env, 'stats_platforms'),
    db.select<MetaRow>(env, 'meta', q().eq('key', 'schema').select('key,value').limit(1)),
    // The meter never fails the Dashboard: no keys or no answer is simply no item.
    analyticsConfigured(env) ? readRequestUsage(env as CfAnalyticsEnv, Date.now(), { timeoutMs: METER_WAIT_MS }) : Promise.resolve(null),
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
    attention: attentionFor(k, schema, meter && meter.ok ? { used: meter.usage.requests, allowance: meter.usage.allowance } : null),
    checkedAt: new Date().toISOString(),
  });
});
