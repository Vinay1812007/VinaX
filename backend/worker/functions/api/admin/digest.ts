/** Latest weekly digest row for the Overview card. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbSelect, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const rows = await dbSelect<{ message: string | null; created_at: string }>(
    env,
    'vinax_events',
    'type=eq.weekly-digest&select=message,created_at&order=created_at.desc&limit=1',
  ).catch(() => []);
  let digest: unknown;
  try {
    digest = rows[0]?.message ? (JSON.parse(rows[0].message) as unknown) : null;
  } catch {
    digest = null;
  }
  return new Response(JSON.stringify({ digest, created_at: rows[0]?.created_at ?? null }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
