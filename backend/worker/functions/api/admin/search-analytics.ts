/** Search analytics: top queries, zero-result queries, trending artists +
 *  languages. Sourced from consent-gated anonymous search events. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbSelect, dbRpc, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const rawDays = parseInt(new URL(request.url).searchParams.get('days') ?? '7', 10);
  // NaN survives Math.min/max and used to throw RangeError -> 500 on ?days=abc (D-5).
  const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 90) : 7;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [rows, artists, languages] = await Promise.all([
    dbSelect<{ message: string | null }>(
      env, 'vinax_events', `type=eq.search&created_at=gte.${encodeURIComponent(since)}&select=message&order=created_at.desc&limit=3000`,
    ),
    dbRpc<unknown[]>(env, 'vinax_top_artists', { days, lim: 12 }).catch(() => []),
    dbRpc<unknown[]>(env, 'vinax_top_languages', { days, lim: 10 }).catch(() => []),
  ]);
  const top = new Map<string, number>();
  const zero = new Map<string, number>();
  for (const r of rows) {
    const raw = r.message ?? '';
    const i = raw.indexOf('|');
    if (i < 0) continue;
    const n = Number(raw.slice(0, i));
    const q = raw.slice(i + 1).trim();
    if (!q) continue;
    top.set(q, (top.get(q) ?? 0) + 1);
    if (n === 0) zero.set(q, (zero.get(q) ?? 0) + 1);
  }
  const sort = (mp: Map<string, number>) =>
    [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([q, c]) => ({ query: q, count: c }));
  return new Response(
    JSON.stringify({ total: rows.length, top: sort(top), zero: sort(zero), artists, languages }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
