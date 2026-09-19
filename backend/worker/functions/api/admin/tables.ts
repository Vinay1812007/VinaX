/**
 * v5.13.0 — Database Overview: row counts and freshness for every table the
 * Worker writes, so retention jobs, a stalled writer or a runaway logger show
 * up as numbers rather than as a surprise on the Supabase bill.
 */
import { dbFailure, isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbCountResult, sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

const TABLES: Array<{ name: string; ts: string; note: string }> = [
  { name: 'vinax_events', ts: 'created_at', note: 'plays, searches, errors, vitals — the analytics firehose' },
  { name: 'vinax_ai_events', ts: 'created_at', note: 'every AI lane call with ok/latency' },
  { name: 'vinax_feedback', ts: 'created_at', note: 'bug reports, feedback, admin audit rows' },
  { name: 'vinax_users', ts: 'created_at', note: 'anonymous device profiles' },
  { name: 'vinax_rooms', ts: 'created_at', note: 'Listen Together rooms' },
  { name: 'vinax_room_members', ts: 'created_at', note: 'room membership' },
  { name: 'vinax_push_subscriptions', ts: 'created_at', note: 'web push endpoints' },
  { name: 'vinax_fcm_tokens', ts: 'created_at', note: 'Android push tokens' },
  { name: 'vinax_seo_urls', ts: 'added_at', note: 'sitemap corpus' },
  { name: 'vinax_experiments', ts: 'created_at', note: 'A/B assignments' },
  { name: 'vinax_blocklist', ts: 'created_at', note: 'blocked songs / artists / keywords' },
  { name: 'vinax_config', ts: 'updated_at', note: 'admin-published app config' },
];

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false, tables: [] });
  const since24h = new Date(Date.now() - 86_400_000).toISOString();
  const reads = await Promise.all(
    TABLES.map(async (t) => {
      const [total, last24h, newest] = await Promise.all([
        sbCountResult(env, t.name),
        sbCountResult(env, t.name, `${t.ts}=gte.${encodeURIComponent(since24h)}`),
        sbSelectResult<Record<string, string>>(env, t.name, `select=${t.ts}&order=${t.ts}.desc&limit=1`),
      ]);
      const newestAt = newest.ok ? (newest.rows[0]?.[t.ts] ?? null) : null;
      const failure = [total, last24h, newest].find((r) => !r.ok);
      return {
        row: {
          name: t.name,
          note: t.note,
          total: total.ok ? total.value : null,
          last24h: last24h.ok ? last24h.value : null,
          newestAt,
          ageMin: newestAt ? Math.round((Date.now() - Date.parse(newestAt)) / 60_000) : null,
          // 7.2.0 — per table: a failed read is `readable: false` with nulls,
          // never a row count of 0 (a missing table is `db_schema_missing`).
          readable: !failure,
          ...(failure && !failure.ok ? { error: failure.error } : {}),
        },
        failure: failure && !failure.ok ? failure : null,
      };
    }),
  );
  const tables = reads.map((r) => r.row);
  const unavailable = tables.filter((t) => !t.readable).map((t) => t.name);
  const firstFail = reads.find((r) => r.failure)?.failure;
  if (unavailable.length === tables.length && firstFail) return dbFailure(firstFail, { unavailable });
  // The grand total is only a total when every table was counted.
  const totalRows = tables.every((t) => t.total !== null) ? tables.reduce((a, t) => a + (t.total ?? 0), 0) : null;
  return json({ configured: true, totalRows, tables, unavailable, checkedAt: new Date().toISOString() });
};
