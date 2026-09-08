/**
 * Admin: Query Console (v5.15.0) — read-only, whitelisted.
 *   GET /api/admin/query?table=vinax_events&hours=24&limit=200&col=type&val=play
 *     → { rows, columns, table, truncated }
 * Only listed tables and columns are readable; push endpoints, tokens and
 * raw identifiers never appear. Equality filter on one whitelisted column,
 * newest first, hard cap 500 rows.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelect, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const QUERYABLE: Record<string, { ts: string; columns: string[] }> = {
  vinax_events: { ts: 'created_at', columns: ['created_at', 'type', 'platform', 'app_version', 'country', 'city', 'region', 'language', 'song_id', 'song_title', 'song_artist', 'message'] },
  vinax_ai_events: { ts: 'created_at', columns: ['created_at', 'feature', 'model', 'ok', 'status', 'error', 'client', 'latency_ms'] },
  vinax_feedback: { ts: 'created_at', columns: ['created_at', 'id', 'type', 'status', 'name', 'message', 'platform', 'app_version', 'country', 'city'] },
  vinax_users: { ts: 'last_seen', columns: ['last_seen', 'first_seen', 'name', 'username', 'platform', 'country', 'city', 'is_playing'] },
  vinax_rooms: { ts: 'updated_at', columns: ['updated_at', 'code', 'host_name', 'song', 'playing'] },
  vinax_experiments: { ts: 'created_at', columns: ['created_at', 'key', 'name', 'active', 'variants'] },
  vinax_blocklist: { ts: 'created_at', columns: ['created_at', 'song_id', 'song_title', 'reason'] },
  vinax_config: { ts: 'updated_at', columns: ['updated_at', 'key', 'value'] },
  vinax_seo_urls: { ts: 'added_at', columns: ['added_at', 'type', 'key', 'name', 'lang'] },
};

const SAFE_VAL = /^[\w .:@/#+-]{1,120}$/;

export function buildQuery(params: URLSearchParams): { table: string; query: string; limit: number; columns: string[] } | { error: string } {
  const table = params.get('table') ?? '';
  const spec = QUERYABLE[table];
  if (!spec) return { error: 'unknown_table' };
  const hours = Math.min(24 * 90, Math.max(1, parseInt(params.get('hours') ?? '24', 10) || 24));
  const limit = Math.min(500, Math.max(1, parseInt(params.get('limit') ?? '200', 10) || 200));
  const col = params.get('col') ?? '';
  const val = params.get('val') ?? '';
  const parts = [`select=${spec.columns.join(',')}`, `${spec.ts}=gte.${encodeURIComponent(new Date(Date.now() - hours * 3_600_000).toISOString())}`, `order=${spec.ts}.desc`, `limit=${limit}`];
  if (col || val) {
    if (!spec.columns.includes(col)) return { error: 'unknown_column' };
    if (!SAFE_VAL.test(val)) return { error: 'bad_value' };
    parts.push(`${col}=eq.${encodeURIComponent(val)}`);
  }
  return { table, query: parts.join('&'), limit, columns: spec.columns };
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false, rows: [] });
  const built = buildQuery(new URL(request.url).searchParams);
  if ('error' in built) return json({ error: built.error, tables: Object.keys(QUERYABLE) }, 400);
  const rows = await sbSelect<Record<string, unknown>>(env, built.table, built.query).catch(() => null);
  if (rows === null) return json({ error: 'query_failed' }, 502);
  return json({ configured: true, table: built.table, columns: built.columns, rows, truncated: rows.length >= built.limit });
};
