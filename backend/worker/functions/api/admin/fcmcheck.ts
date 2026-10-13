/**
 * 12.2.1 — GET /api/admin/fcmcheck → { configured, project, token, fcm, detail, devices }
 * The Android push setup in one look: which project FCM_SERVICE_ACCOUNT is
 * for, whether Google accepts it, how FCM answers a validate-only message
 * (nothing is delivered), and how many Android devices are registered.
 * Never returns any part of the key.
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { checkFcm, type FcmEnv } from '../../_lib/fcm';
import { sbCount, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & FcmEnv & SupabaseEnv;

export const onRequestGet = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  if (!(await isAdminAsync(ctx.request, ctx.env))) return unauthorized();
  const [check, devices] = await Promise.all([checkFcm(ctx.env), sbCount(ctx.env, 'vinax_fcm_tokens').catch(() => null)]);
  return new Response(JSON.stringify({ ...check, devices }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};
