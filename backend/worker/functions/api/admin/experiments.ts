/**
 * GET  /api/admin/experiments → { configured, rows, activeUsers }
 *        Every A/B test with its versions, who is included, its lifecycle and
 *        winner, plus how many people used the app in the last 7 days (the
 *        console estimates "about N users per version" from it).
 * POST /api/admin/experiments
 *        { action: 'save', key, name, description?, variants, audience?, status? | active? }
 *        { action: 'status', key, status: 'running' | 'paused' | 'finished' | 'draft', winner? }
 *        { action: 'delete', key }
 *
 * Tests are assigned on the device (_lib/experiments.ts): the server never
 * learns who is in which version. Variants are [{ name, pct }] (they may add
 * up to less than 100 — the rest is not in the test); `audience` is
 * { platform: all|android|web|ios, minVersion, percent }. `active` mirrors
 * status === 'running' (the public /api/experiments reads it).
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost, camel } from '../../_lib/adminRoute';
import { db, q } from '../../_lib/db';
import { clip } from '../../_lib/edge';
import { sanitizeAudience, sanitizeVariants } from '../../_lib/experiments';

const KEY_RE = /^[a-z0-9-]{1,40}$/;
const STATUSES = ['draft', 'running', 'paused', 'finished'] as const;
type Status = (typeof STATUSES)[number];
const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v);

export const onRequestGet = adminGet(async ({ env }) => {
  const [r, active] = await Promise.all([
    db.select<Record<string, unknown>>(env, 'experiments', q().select('*').order('updated_at', 'desc').limit(200)),
    db.count(env, 'accounts', q().gte('last_seen', new Date(Date.now() - 7 * 86_400_000).toISOString())),
  ]);
  if (!r.ok) return dbFailure(r);
  return adminJson({
    configured: true,
    activeUsers: active.ok ? active.value : null,
    rows: r.rows.map((row) => {
      const c = camel(row);
      // A row from before the console rebuild has no status: derive it from `active`.
      if (!isStatus(c.status)) c.status = c.active ? 'running' : 'draft';
      c.audience = sanitizeAudience(c.audience);
      return c;
    }),
  });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  const key = typeof body.key === 'string' ? body.key.trim().toLowerCase() : '';
  if (!KEY_RE.test(key)) return badRequest('bad_key');
  const now = new Date().toISOString();
  const before = await db.one<Record<string, unknown>>(env, 'experiments', q().eq('key', key).select('*'));

  if (body.action === 'save') {
    const variants = sanitizeVariants(body.variants);
    if (!variants.length) return badRequest('bad_variants');
    const status: Status = isStatus(body.status) ? body.status : body.active === true ? 'running' : 'draft';
    const prev = before.ok ? before.value : null;
    const row = {
      key,
      name: clip(body.name, 60),
      description: clip(body.description, 300),
      variants,
      audience: sanitizeAudience(body.audience),
      status,
      active: status === 'running',
      started_at: status === 'running' ? (prev?.started_at as string | null | undefined) ?? now : (prev?.started_at as string | null | undefined) ?? null,
      updated_at: now,
    };
    const r = await db.upsert<Record<string, unknown>>(env, 'experiments', row, 'key', { returning: true });
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'experiment-save', summary: `${prev ? 'updated' : 'created'} A/B test ${key} (${status})`, target: key, before: prev ?? undefined, after: row });
    return adminJson({ ok: true, row: r.rows[0] ? camel(r.rows[0]) : row });
  }

  if (body.action === 'status') {
    if (!isStatus(body.status)) return badRequest('bad_status');
    if (!before.ok) return dbFailure(before);
    if (!before.value) return adminJson({ error: 'not_found' }, 404);
    const status = body.status;
    const variants = sanitizeVariants(before.value.variants);
    const winner = status === 'finished' ? clip(body.winner, 24) : null;
    if (winner && !variants.some((v) => v.name === winner)) return badRequest('bad_winner');
    const patch = {
      status,
      active: status === 'running',
      started_at: status === 'running' && !before.value.started_at ? now : (before.value.started_at as string | null) ?? null,
      ended_at: status === 'finished' ? now : null,
      winner,
      updated_at: now,
    };
    const r = await db.update<Record<string, unknown>>(env, 'experiments', q().eq('key', key), patch, { returning: true });
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'experiment-status', summary: `A/B test ${key} → ${status}${winner ? ` (winner: ${winner})` : ''}`, target: key, before: { status: before.value.status ?? (before.value.active ? 'running' : 'draft') }, after: patch });
    return adminJson({ ok: true, row: r.rows[0] ? camel(r.rows[0]) : patch });
  }

  if (body.action === 'delete') {
    const r = await db.remove<Record<string, unknown>>(env, 'experiments', q().eq('key', key), { returning: true });
    if (!r.ok) return dbFailure(r);
    if (!r.rows.length) return adminJson({ error: 'not_found' }, 404);
    await audit({ action: 'experiment-delete', summary: `deleted A/B test ${key}`, target: key, before: r.rows[0] });
    return adminJson({ ok: true, deleted: 1 });
  }
  return badRequest('unknown_action');
});
