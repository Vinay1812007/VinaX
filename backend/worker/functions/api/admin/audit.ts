/** Admin audit trail: site-mode flips, sends, daily picks, audited deletions. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbSelect, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const [events, audits] = await Promise.all([
    dbSelect<{ type: string; message: string | null; created_at: string }>(
      env,
      'vinax_events',
      'type=in.(site-mode,announcement,song-push)&select=type,message,created_at&order=created_at.desc&limit=25',
    ).catch(() => []),
    dbSelect<{ message: string | null; created_at: string }>(
      env,
      'vinax_feedback',
      'type=eq.admin-audit&select=message,created_at&order=created_at.desc&limit=15',
    ).catch(() => []),
  ]);
  const items = [
    ...events.map((e) => ({ kind: e.type, text: e.message ?? '', at: e.created_at })),
    // E12 — messages pack "kind|text"; legacy rows without a pipe are the old
    // maintenance deletions and keep their 'user-delete' label.
    ...audits.map((a) => {
      const msg = a.message ?? '';
      const pipe = msg.indexOf('|');
      return pipe > 0
        ? { kind: msg.slice(0, pipe), text: msg.slice(pipe + 1), at: a.created_at }
        : { kind: 'user-delete', text: msg, at: a.created_at };
    }),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30);
  return new Response(JSON.stringify({ items }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
