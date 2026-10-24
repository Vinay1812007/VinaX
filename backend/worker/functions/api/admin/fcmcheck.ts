/**
 * 12.2.1 — GET /api/admin/fcmcheck → { configured, project, token, fcm, detail }
 * The Android push setup in one look: which project FCM_SERVICE_ACCOUNT is
 * for, whether Google accepts it, and how FCM answers a validate-only message
 * (nothing is delivered). Never returns any part of the key.
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { checkFcm, type FcmEnv } from '../../_lib/fcm';

type Env = AdminEnv & FcmEnv;

export const onRequestGet = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  if (!(await isAdminAsync(ctx.request, ctx.env))) return unauthorized();
  const check = await checkFcm(ctx.env);
  return new Response(JSON.stringify(check), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};
