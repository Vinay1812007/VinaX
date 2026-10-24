/**
 * GET  /api/admin/listeners?q=&platform=&days=&limit=&offset=  → the directory
 * GET  /api/admin/listeners?id=<listener> | ?account=<sub>      → one profile
 * POST /api/admin/listeners { action: 'delete', id?, account?, reason }
 *
 * The directory view merges devices and accounts into one row per person.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost, camel, paging } from '../../_lib/adminRoute';
import { db, like, q, since, DAY_MS, firstFailure, type Query } from '../../_lib/db';
import { clip, intIn, platformOf, PLATFORMS } from '../../_lib/edge';

const ID_RE = /^[a-z]_[a-f0-9]{16,64}$/;
const SUB_RE = /^\d{1,40}$/;

function filters(url: URL): Query {
  const query = q();
  const text = clip(url.searchParams.get('q'), 80);
  if (text) {
    const pat = `*${like(text)}*`;
    query.or(`name.ilike.${pat}`, `handle.ilike.${pat}`, `email.ilike.${pat}`);
  }
  const platform = url.searchParams.get('platform');
  if (platform && (PLATFORMS as readonly string[]).includes(platform)) query.eq('platform', platformOf(platform));
  const days = intIn(url.searchParams.get('days'), 1, 365);
  if (days) query.gte('last_seen', since(days * DAY_MS));
  return query;
}

export const onRequestGet = adminGet(async ({ env, url }) => {
  const id = clip(url.searchParams.get('id'), 80);
  const account = clip(url.searchParams.get('account'), 40);
  if (id || account) {
    if ((id && !ID_RE.test(id)) || (account && !SUB_RE.test(account))) return badRequest('bad_id');
    const r = await db.rpc<Record<string, unknown> | null>(env, 'listener_profile', { p_listener: id, p_account: account });
    if (!r.ok) return dbFailure(r);
    const profile = r.value && typeof r.value === 'object' ? r.value : null;
    if (!profile || (!profile.listener && !profile.account)) return adminJson({ configured: true, error: 'not_found' }, 404);
    return adminJson({ configured: true, profile });
  }

  const { limit, offset } = paging(url, 50, 200);
  const [rows, total, platforms] = await Promise.all([
    db.select<Record<string, unknown>>(env, 'directory', filters(url).select('*').order('last_seen', 'desc').limit(limit).offset(offset)),
    db.count(env, 'directory', filters(url).select('listener_id')),
    db.rpc<{ platforms: Array<{ platform: string; listeners: number; accounts: number }> }>(env, 'stats_platforms'),
  ]);
  const failed = firstFailure(rows, total, platforms);
  if (failed) return dbFailure(failed);
  if (!rows.ok || !total.ok || !platforms.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);
  const byPlatform: Record<string, { listeners: number; accounts: number }> = {};
  let listeners = 0;
  let accounts = 0;
  for (const p of platforms.value?.platforms ?? []) {
    byPlatform[p.platform] = { listeners: Number(p.listeners) || 0, accounts: Number(p.accounts) || 0 };
    listeners += Number(p.listeners) || 0;
    accounts += Number(p.accounts) || 0;
  }
  return adminJson({ configured: true, total: total.value, limit, offset, rows: rows.rows.map(camel), counts: { listeners, accounts, byPlatform } });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  if (body.action !== 'delete') return badRequest('unknown_action');
  const id = clip(body.id, 80);
  const account = clip(body.account, 40);
  if (!id && !account) return badRequest();
  if ((id && !ID_RE.test(id)) || (account && !SUB_RE.test(account))) return badRequest('bad_id');
  const reason = clip(body.reason, 200) ?? 'no reason given';
  const r = await db.rpc<Record<string, number>>(env, 'delete_listener', { p_listener: id, p_account: account });
  if (!r.ok) return dbFailure(r);
  const deleted = r.value ?? {};
  await audit({ action: 'listener-delete', summary: `deleted ${id ? `listener ${id}` : `account ${account}`} — ${reason}`, target: id ?? account ?? undefined, after: deleted });
  return adminJson({ ok: true, deleted });
});
