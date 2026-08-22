/** Admin audit trail: site-mode flips, sends, daily picks, audited deletions. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelect, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const [events, audits] = await Promise.all([
    sbSelect<{ type: string; message: string | null; created_at: string }>(
      env,
      'vinax_events',
      'type=in.(site-mode,announcement,song-push)&select=type,message,created_at&order=created_at.desc&limit=25',
    ).catch(() => []),
    sbSelect<{ message: string | null; created_at: string }>(
      env,
      'vinax_feedback',
      'type=eq.admin-audit&select=message,created_at&order=created_at.desc&limit=15',
    ).catch(() => []),
  ]);
  const items = [
    ...events.map((e) => ({ kind: e.type, text: e.message ?? '', at: e.created_at })),
    ...audits.map((a) => ({ kind: 'user-delete', text: a.message ?? '', at: a.created_at })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30);
  return new Response(JSON.stringify({ items }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
