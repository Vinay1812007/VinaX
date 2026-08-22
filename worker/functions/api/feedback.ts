/** Public feedback / bug-report ingest. Users explicitly submit this, so it is
 *  not consent-gated. Coarse geo is added at the edge; no raw IP is stored. */
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { sbInsert, supabaseConfigured, type SupabaseEnv } from '../_lib/supabase';

type Env = SupabaseEnv;
interface CfExtras { cf?: { country?: string; city?: string } }

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

function clip(v: unknown, n: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, n) : null;
}

/** POST-only: answer GET with an honest 405 instead of the SPA shell (DQA-07). */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'feedback', { capacity: 5, refillPerMinute: 2 });
  if (limited) return limited;
  const json = (b: unknown, status = 200): Response =>
    new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...CORS } });

  if (!supabaseConfigured(env)) return json({ error: 'not_configured' }, 503);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const message = body ? clip(body.message, 2000) : null;
  if (!message) return json({ error: 'message_required' }, 400);

  const cf = (request as Request & CfExtras).cf ?? {};
  const ipCountry = request.headers.get('CF-IPCountry');
  const country = (ipCountry && ipCountry !== 'XX' && ipCountry !== 'T1' ? ipCountry : cf.country) ?? null;

  const ok = await sbInsert(env, 'vinax_feedback', {
    device_id: body ? clip(body.deviceId, 64) : null,
    name: body ? clip(body.name, 80) : null,
    type: (body ? clip(body.type, 16) : null) ?? 'other',
    message,
    app_version: body ? clip(body.appVersion, 24) : null,
    platform: (body ? clip(body.platform, 12) : null) ?? 'web',
    country,
    city: cf.city ?? null,
  });

  return json({ ok });
};
