/** Store a native Android FCM device token (upsert by token). Anonymous — just
 *  the opaque device token, so background push can reach a closed app. */
import { sbUpsert, type SupabaseEnv } from '../../_lib/supabase';
import { rateLimit } from '../../_lib/ratelimit';
import { cleanTzOffset } from '../../_lib/notifyGate';

interface FcmRegisterEnv extends SupabaseEnv {
  TELEMETRY_PEPPER?: string;
}

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

interface CfExtras { cf?: { country?: string; region?: string; city?: string } }

export const onRequestPost = async (context: { request: Request; env: FcmRegisterEnv }): Promise<Response> => {
  const { request, env } = context;
  // Audit finding H-SRV-3.
  const limited = rateLimit(request, 'push-fcm', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { token?: string; lang?: string; platform?: string; tzOffset?: number } | null;
  const token = body?.token;
  if (!token || token.length < 20 || token.length > 4096) return json({ error: 'bad_request' }, 400);
  const cf = (request as Request & CfExtras).cf ?? {};
  const country = request.headers.get('CF-IPCountry') ?? cf.country ?? null;
  const ok = await sbUpsert(
    env,
    'vinax_fcm_tokens',
    {
      token,
      platform: typeof body?.platform === 'string' ? body.platform.slice(0, 16) : 'android',
      lang: typeof body?.lang === 'string' ? body.lang.slice(0, 8) : null,
      country: country && country !== 'XX' && country !== 'T1' ? country : null,
      region: cf.region ?? null,
      city: cf.city ?? null,
      tz_offset: cleanTzOffset(body?.tzOffset),
      active: true,
      updated_at: new Date().toISOString(),
    },
    'token',
  );
  return json({ ok }, ok ? 200 : 500);
};
