/**
 * Package E2 — public experiment config. Anonymous, cacheable, tiny: just the
 * ACTIVE experiments' keys and variant splits. Assignment happens on-device
 * (deterministic hash — see _lib/experiments.ts), so this endpoint learns
 * nothing about anyone; it's the same trust shape as /api/blocklist.
 */
import { sbSelect, type SupabaseEnv } from '../_lib/supabase';
import { sanitizeVariants } from '../_lib/experiments';

type Env = SupabaseEnv;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

interface Row {
  key: string;
  variants: unknown;
  active: boolean | null;
}

export const onRequestGet = async (context: { env: Env }): Promise<Response> => {
  const rows = await sbSelect<Row>(context.env, 'vinax_experiments', 'active=eq.true&select=key,variants,active&limit=50');
  const experiments = rows
    .map((r) => ({ key: r.key, variants: sanitizeVariants(r.variants) }))
    .filter((e) => e.key && e.variants.length);
  return new Response(JSON.stringify({ experiments }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', ...CORS },
  });
};
