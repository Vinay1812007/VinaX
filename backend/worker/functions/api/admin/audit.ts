/** Admin audit trail: site-mode flips, sends, daily picks, audited deletions. */
import { adminJson, dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) return adminJson({ configured: false, items: [] });
  const [eventsRead, auditsRead] = await Promise.all([
    sbSelectResult<{ type: string; message: string | null; created_at: string }>(
      env,
      'vinax_events',
      'type=in.(site-mode,announcement,song-push)&select=type,message,created_at&order=created_at.desc&limit=25',
    ),
    sbSelectResult<{ message: string | null; created_at: string }>(
      env,
      'vinax_feedback',
      'type=eq.admin-audit&select=message,created_at&order=created_at.desc&limit=15',
    ),
  ]);
  // 7.2.0 — a trail with a failed half would silently omit actions.
  if (!eventsRead.ok) return dbFailure(eventsRead);
  if (!auditsRead.ok) return dbFailure(auditsRead);
  const events = eventsRead.rows;
  const audits = auditsRead.rows;
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
  return adminJson({ configured: true, items });
};
