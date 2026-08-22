/**
 * Package E12 — one helper, every mutating admin action leaves a row.
 *
 * Rides the existing vinax_feedback channel (type='admin-audit') that the
 * maintenance deletions already use — no migration. The message packs
 * "kind|text"; /api/admin/audit splits on the first pipe (legacy rows without
 * one keep their old 'user-delete' label). Best-effort by design: an audit
 * write must never fail the action it describes.
 */
import { sbInsert, type SupabaseEnv } from './supabase';

export function logAdminAudit(env: SupabaseEnv, kind: string, text: string): Promise<void> {
  return sbInsert(env, 'vinax_feedback', {
    type: 'admin-audit',
    // Explicit status: the column defaults to 'new', which made every audit
    // write inflate the Overview "New feedback" KPI and render in the inbox;
    // 'resolved' would get erased by the clear_feedback maintenance action.
    // 'audit' is outside both filters (admin audit D-4).
    status: 'audit',
    message: `${kind.slice(0, 24).replace(/\|/g, '/')}|${text.slice(0, 400)}`,
  })
    .then(() => undefined)
    .catch(() => undefined);
}
