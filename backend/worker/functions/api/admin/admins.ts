/**
 * Version 8 — Admins & Roles.
 *
 * GET  /api/admin/admins → { configured, rows, me, bootstrap }
 * POST /api/admin/admins (owner only)
 *        { action: 'invite', email, role }   add an email (it can then sign in with Google)
 *        { action: 'role', email, role }     change a role
 *        { action: 'remove', email }         take an email off the list
 * The console never ends up without an owner: the last owner cannot be
 * demoted or removed.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { bootstrapOwners, isAdminRole, normEmail, resetAdminMemo, type AdminRow } from '../../_lib/adminAuth';
import { db, q } from '../../_lib/db';

const COLS = 'email,name,picture,role,invited_by,created_at,last_sign_in';
const shape = (r: AdminRow) => ({ email: r.email, name: r.name, picture: r.picture, role: r.role, invitedBy: r.invited_by, createdAt: r.created_at, lastSignIn: r.last_sign_in });

export const onRequestGet = adminGet(async ({ env, me }) => {
  const r = await db.select<AdminRow>(env, 'admins', q().select(COLS).order('created_at', 'asc').limit(200));
  if (!r.ok) return dbFailure(r);
  return adminJson({
    configured: true,
    rows: r.rows.map(shape),
    bootstrap: bootstrapOwners(env as never),
    me: { email: me.email, name: me.name, picture: me.picture, role: me.role, via: me.via },
  });
});

export const onRequestPost = adminPost(async ({ env, body, audit, me }) => {
  const email = normEmail(body.email);
  if (!email) return badRequest('bad_email');
  const all = await db.select<AdminRow>(env, 'admins', q().select(COLS).limit(200));
  if (!all.ok) return dbFailure(all);
  const current = all.rows.find((r) => r.email === email) ?? null;
  const owners = all.rows.filter((r) => r.role === 'owner').length + bootstrapOwners(env as never).filter((e) => !all.rows.some((r) => r.email === e && r.role === 'owner')).length;

  if (body.action === 'invite') {
    if (!isAdminRole(body.role)) return badRequest('bad_role');
    if (current) return adminJson({ error: 'already_admin' }, 409);
    const w = await db.insert<AdminRow>(env, 'admins', { email, role: body.role, invited_by: me.email }, { returning: true });
    if (!w.ok) return dbFailure(w);
    resetAdminMemo();
    await audit({ action: 'admin-invite', summary: `invited ${email} as ${body.role}`, target: email, after: { email, role: body.role } });
    return adminJson({ ok: true, row: w.rows[0] ? shape(w.rows[0]) : null });
  }
  if (body.action === 'role') {
    if (!isAdminRole(body.role)) return badRequest('bad_role');
    if (!current) return adminJson({ error: 'not_found' }, 404);
    if (current.role === 'owner' && body.role !== 'owner' && owners <= 1) return adminJson({ error: 'last_owner' }, 409);
    const w = await db.update<AdminRow>(env, 'admins', q().eq('email', email), { role: body.role }, { returning: true });
    if (!w.ok) return dbFailure(w);
    resetAdminMemo();
    await audit({ action: 'admin-role', summary: `${email}: ${current.role} → ${body.role}`, target: email, before: { role: current.role }, after: { role: body.role } });
    return adminJson({ ok: true, row: w.rows[0] ? shape(w.rows[0]) : null });
  }
  if (body.action === 'remove') {
    if (!current) return adminJson({ error: 'not_found' }, 404);
    if (current.role === 'owner' && owners <= 1) return adminJson({ error: 'last_owner' }, 409);
    const w = await db.remove(env, 'admins', q().eq('email', email), { returning: true });
    if (!w.ok) return dbFailure(w);
    resetAdminMemo();
    await audit({ action: 'admin-remove', summary: `removed ${email} (${current.role})`, target: email, before: { role: current.role } });
    return adminJson({ ok: true });
  }
  return badRequest('unknown_action');
}, { role: 'owner' });
