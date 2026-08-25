/** Location Analytics: listeners + plays by country / city, and platform split.
 *  Coarse + anonymous: city/country come from the Cloudflare edge; no raw IP. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbRpc, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

function clampDays(v: string | null): number {
  const n = parseInt(v ?? '7', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 90) : 7;
}

interface GeoRow { country: string; city: string; listeners: number; plays: number; }
interface PlatRow { platform: string; listeners: number; }

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const days = clampDays(new URL(request.url).searchParams.get('days'));
  const [geo, platforms] = await Promise.all([
    dbRpc<GeoRow[]>(env, 'vinax_geo', { days }),
    dbRpc<PlatRow[]>(env, 'vinax_platforms', {}),
  ]);

  const rows = geo ?? [];
  const byCountry: Record<string, number> = {};
  for (const r of rows) byCountry[r.country] = (byCountry[r.country] ?? 0) + r.listeners;
  const countries = Object.entries(byCountry)
    .map(([country, listeners]) => ({ country, listeners }))
    .sort((a, b) => b.listeners - a.listeners);

  return new Response(
    JSON.stringify({
      days,
      countries,
      cities: rows.slice(0, 50),
      platforms: platforms ?? [],
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
