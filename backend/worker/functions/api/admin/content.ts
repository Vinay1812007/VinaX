/**
 * GET  /api/admin/content → { configured, blocked, suggestions, reasons }
 * POST /api/admin/content { action: 'block', kind, value, label?, reason? } | { action: 'unblock', id }
 *                          | { action: 'reason', id, reason }   change why it is blocked
 *
 * The blocklist the app downloads (/api/blocklist): songs and albums by id,
 * artists by name, keywords. `reason` is one of REASONS; `blocked_by` is the
 * admin who blocked it. `suggestions` are the month's most played songs.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost, camel, idOf } from '../../_lib/adminRoute';
import { db, q, firstFailure } from '../../_lib/db';
import { clip } from '../../_lib/edge';

const KINDS = ['song', 'album', 'artist', 'keyword'] as const;
type Kind = (typeof KINDS)[number];
/** The reasons the console offers (plain words, stored as shown). */
export const REASONS = ['Copyright', 'Wrong audio', 'Offensive', 'Other'] as const;

export const onRequestGet = adminGet(async ({ env }) => {
  const [blocked, music] = await Promise.all([
    db.select<Record<string, unknown>>(env, 'blocked_content', q().select('*').order('created_at', 'desc').limit(1000)),
    db.rpc<{ songs?: unknown[] }>(env, 'stats_music', { p_days: 30, p_limit: 20 }),
  ]);
  const failed = firstFailure(blocked, music);
  if (failed) return dbFailure(failed);
  if (!blocked.ok || !music.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);
  return adminJson({ configured: true, blocked: blocked.rows.map(camel), suggestions: Array.isArray(music.value?.songs) ? music.value.songs : [], reasons: REASONS });
});

export const onRequestPost = adminPost(async ({ env, body, audit, me }) => {
  if (body.action === 'block') {
    const kind = body.kind as Kind;
    if (!KINDS.includes(kind)) return badRequest('bad_kind');
    let value = clip(body.value, 200);
    if (kind === 'keyword') value = value?.toLowerCase() ?? null;
    if (!value || (kind === 'keyword' && value.length < 3)) return badRequest('bad_value');
    const reasonIn = clip(body.reason, 300);
    const reason = reasonIn ? ((REASONS as readonly string[]).find((r) => r.toLowerCase() === reasonIn.toLowerCase()) ?? 'Other') : null;
    const row = { kind, value, label: clip(body.label, 200), reason, blocked_by: me.email };
    const r = await db.insert<Record<string, unknown>>(env, 'blocked_content', row, { returning: true });
    if (!r.ok && r.error === 'conflict') return adminJson({ ok: true, already: true, row: camel(row) });
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'content-block', summary: `blocked ${kind} "${row.label ?? value}"${reason ? ` (${reason})` : ''}`, target: `${kind}:${value}`, after: row });
    return adminJson({ ok: true, row: r.rows[0] ? camel(r.rows[0]) : camel(row) });
  }
  if (body.action === 'reason') {
    const id = idOf(body.id);
    const reason = (REASONS as readonly string[]).find((r) => r === body.reason);
    if (!id || !reason) return badRequest();
    const r = await db.update<Record<string, unknown>>(env, 'blocked_content', q().eq('id', id), { reason }, { returning: true });
    if (!r.ok) return dbFailure(r);
    if (!r.rows.length) return adminJson({ error: 'not_found' }, 404);
    await audit({ action: 'content-reason', summary: `reason for "${String(r.rows[0].label ?? r.rows[0].value)}" → ${reason}`, target: String(id), after: { reason } });
    return adminJson({ ok: true, row: camel(r.rows[0]) });
  }
  if (body.action === 'unblock') {
    const id = idOf(body.id);
    if (!id) return badRequest();
    const r = await db.remove<Record<string, unknown>>(env, 'blocked_content', q().eq('id', id), { returning: true });
    if (!r.ok) return dbFailure(r);
    if (!r.rows.length) return adminJson({ error: 'not_found' }, 404);
    await audit({ action: 'content-unblock', summary: `unblocked ${String(r.rows[0].kind)} "${String(r.rows[0].label ?? r.rows[0].value)}"`, target: String(id), before: r.rows[0] });
    return adminJson({ ok: true, deleted: 1 });
  }
  return badRequest('unknown_action');
});
