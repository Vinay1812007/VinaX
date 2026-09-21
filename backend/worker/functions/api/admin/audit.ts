/** Admin audit trail: site-mode flips, sends, daily picks, audited deletions. */
import { adminJson, dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { parseAuditMessage } from '../../_lib/adminAudit';
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
  const items: Array<Record<string, unknown> & { kind: string; text: string; at: string }> = [
    ...events.map((e) => ({ kind: e.type, text: e.message ?? '', at: e.created_at })),
    // Audit rows pack "action|record". 7.2.0 records are JSON and carry the
    // actor, the request id and redacted before/after values; the older
    // "kind|text" rows (and pre-E12 rows without a pipe) still read.
    ...audits.map((a) => {
      const { action, text, record } = parseAuditMessage(a.message);
      return record
        ? {
            kind: action,
            text,
            at: record.at || a.created_at,
            actor: record.actor?.id ?? null,
            actorVia: record.actor?.via ?? null,
            requestId: record.requestId ?? null,
            ...(record.target !== undefined ? { target: record.target } : {}),
            ...('before' in record ? { before: record.before } : {}),
            ...('after' in record ? { after: record.after } : {}),
          }
        : { kind: action, text, at: a.created_at };
    }),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30);
  return adminJson({ configured: true, items });
};
