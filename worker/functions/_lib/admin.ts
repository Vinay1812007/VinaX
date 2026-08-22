/** Shared admin-token gate for the /api/admin/* dashboards. */
import { safeEqual } from './safe-compare';

export interface AdminEnv {
  ADMIN_LOGIN_PASSWORD?: string;
}

export function isAdmin(request: Request, env: AdminEnv): boolean {
  if (!env.ADMIN_LOGIN_PASSWORD) return false;
  const header = request.headers.get('x-admin-token') ?? '';
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const token = header || bearer;
  if (!token) return false;
  // Constant-time compare so `===` short-circuit timing can't leak the secret
  // byte by byte over the network.
  return safeEqual(token, env.ADMIN_LOGIN_PASSWORD);
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
