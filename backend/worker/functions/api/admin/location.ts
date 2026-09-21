/** Location Analytics: listeners + plays by country / city, and platform split.
 *  Coarse + anonymous: city/country come from the Cloudflare edge; no raw IP. */
import { adminJson, dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpcResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

function clampDays(v: string | null): number {
  const n = parseInt(v ?? '7', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 90) : 7;
}

interface GeoRow { country: string; city: string; listeners: number; plays: number; }
interface PlatRow { platform: string; listeners: number; }

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();

  const days = clampDays(new URL(request.url).searchParams.get('days'));
  if (!supabaseConfigured(env)) return adminJson({ configured: false, days, countries: [], cities: [], platforms: [] });
  const [geo, platforms] = await Promise.all([
    sbRpcResult<GeoRow[]>(env, 'vinax_geo', { days }),
    sbRpcResult<PlatRow[]>(env, 'vinax_platforms', {}),
  ]);
  // 7.2.0 — an empty map from a failed read looks like "no listeners anywhere".
  if (!geo.ok) return dbFailure(geo);
  if (!platforms.ok) return dbFailure(platforms);

  const rows = geo.value ?? [];
  const byCountry: Record<string, number> = {};
  for (const r of rows) byCountry[r.country] = (byCountry[r.country] ?? 0) + r.listeners;
  const countries = Object.entries(byCountry)
    .map(([country, listeners]) => ({ country, listeners }))
    .sort((a, b) => b.listeners - a.listeners);

  return adminJson({
    configured: true,
    days,
    countries,
    cities: rows.slice(0, 50),
    platforms: platforms.value ?? [],
  });
};
