/**
 * GET  /api/admin/experiments → { configured, rows }
 * POST /api/admin/experiments { action: 'save', key, name, variants, active } | { action: 'delete', key }
 *
 * A/B experiments the app assigns on-device (_lib/experiments.ts). Variants
 * are [{ name, pct }] and may add up to less than 100 — the rest is not in
 * the experiment.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost, camel } from '../../_lib/adminRoute';
import { db, q } from '../../_lib/db';
import { clip } from '../../_lib/edge';
import { sanitizeVariants } from '../../_lib/experiments';

const KEY_RE = /^[a-z0-9-]{1,40}$/;

export const onRequestGet = adminGet(async ({ env }) => {
  const r = await db.select<Record<string, unknown>>(env, 'experiments', q().select('*').order('updated_at', 'desc').limit(200));
  if (!r.ok) return dbFailure(r);
  return adminJson({ configured: true, rows: r.rows.map(camel) });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  const key = typeof body.key === 'string' ? body.key.trim().toLowerCase() : '';
  if (!KEY_RE.test(key)) return badRequest('bad_key');
  if (body.action === 'save') {
    const variants = sanitizeVariants(body.variants);
    if (!variants.length) return badRequest('bad_variants');
    const row = { key, name: clip(body.name, 60), variants, active: body.active === true, updated_at: new Date().toISOString() };
    const before = await db.one<Record<string, unknown>>(env, 'experiments', q().eq('key', key).select('*'));
    const r = await db.upsert<Record<string, unknown>>(env, 'experiments', row, 'key', { returning: true });
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'experiment-save', summary: `${before.ok && before.value ? 'updated' : 'created'} experiment ${key} (${row.active ? 'on' : 'off'})`, target: key, before: before.ok ? before.value : undefined, after: row });
    return adminJson({ ok: true, row: r.rows[0] ? camel(r.rows[0]) : row });
  }
  if (body.action === 'delete') {
    const r = await db.remove<Record<string, unknown>>(env, 'experiments', q().eq('key', key), { returning: true });
    if (!r.ok) return dbFailure(r);
    if (!r.rows.length) return adminJson({ error: 'not_found' }, 404);
    await audit({ action: 'experiment-delete', summary: `deleted experiment ${key}`, target: key, before: r.rows[0] });
    return adminJson({ ok: true, deleted: 1 });
  }
  return badRequest('unknown_action');
});
