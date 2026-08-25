/**
 * Public, cached read side of the admin config store (vinax_config).
 *
 *   GET /api/appconfig?key=banners      → { banners: [...active only] }
 *   GET /api/appconfig?key=home-config  → { config: {...} | null }
 *   GET /api/appconfig?key=festival     → { festival: {mode,id} | null }
 *
 * Served with s-maxage=300 so every client hit lands on the edge cache;
 * publishing from the admin becomes visible within five minutes. Banners are
 * filtered to their schedule window HERE so clients never see (or ship logic
 * for) expired/unstarted campaigns.
 */
import { sbSelect, supabaseConfigured, type SupabaseEnv } from '../_lib/supabase';

interface ConfigRow {
  value: unknown;
}

export interface Banner {
  id?: string;
  title?: string;
  subtitle?: string;
  linkType?: string;
  linkId?: string;
  start?: string;
  end?: string;
  img?: string;
}

const json = (o: unknown, sMaxAge = 300): Response =>
  new Response(JSON.stringify(o), {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=60, s-maxage=${sMaxAge}`,
      'access-control-allow-origin': '*',
    },
  });

/** A banner is live when today is inside its (optional) start/end window. */
export function activeBanners(value: unknown, now = new Date()): Banner[] {
  if (!Array.isArray(value)) return [];
  const today = now.toISOString().slice(0, 10);
  return (value as Banner[])
    .filter((b) => b && typeof b === 'object' && typeof b.title === 'string' && b.title.trim())
    .filter((b) => {
      const start = typeof b.start === 'string' && b.start ? b.start : null;
      const end = typeof b.end === 'string' && b.end ? b.end : null;
      if (start && today < start) return false;
      if (end && today > end) return false;
      return true;
    })
    .slice(0, 10);
}

export const onRequestGet = async (context: { request: Request; env: SupabaseEnv }): Promise<Response> => {
  const { request, env } = context;
  const key = new URL(request.url).searchParams.get('key') ?? '';
  if (key !== 'banners' && key !== 'home-config' && key !== 'festival') {
    return new Response(JSON.stringify({ error: 'unknown_key' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  if (!supabaseConfigured(env)) {
    if (key === 'banners') return json({ banners: [] });
    if (key === 'festival') return json({ festival: null }, 60);
    return json({ config: null });
  }
  const rows = await sbSelect<ConfigRow>(env, 'vinax_config', `key=eq.${encodeURIComponent(key)}&select=value&limit=1`).catch(
    () => [] as ConfigRow[],
  );
  const value = rows[0]?.value ?? null;
  if (key === 'banners') return json({ banners: activeBanners(value) });
  // Festival theme override — cached only briefly so an admin force/off
  // switch reaches listeners within about a minute, not five.
  if (key === 'festival') return json({ festival: value }, 60);
  return json({ config: value });
};
