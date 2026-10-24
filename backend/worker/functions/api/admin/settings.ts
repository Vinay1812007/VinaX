/**
 * GET  /api/admin/settings          → { configured, keys, values, updated }
 * GET  /api/admin/settings?key=x    → { configured, key, value, updatedAt, updatedBy, history }
 * POST /api/admin/settings { key, value }   (value null clears the key)
 *
 * Published settings (_lib/settings.ts): only the keys in SETTING_KEYS exist.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { db, q } from '../../_lib/db';
import { isSettingKey, readSettings, resetSettingsMemo, SETTING_KEYS, writeSetting } from '../../_lib/settings';

export const onRequestGet = adminGet(async ({ env, url }) => {
  resetSettingsMemo();
  const rows = await readSettings(env);
  if (!rows.ok) return dbFailure(rows);
  const key = url.searchParams.get('key');
  if (key) {
    if (!isSettingKey(key)) return badRequest('unknown_key');
    const row = rows.rows.find((r) => r.key === key) ?? null;
    const history = await db.select<{ at: string; by: string; value: unknown }>(env, 'settings_history', q().eq('key', key).select('at,by,value').order('at', 'desc').limit(30));
    if (!history.ok) return dbFailure(history);
    return adminJson({ configured: true, key, spec: SETTING_KEYS.find((s) => s.key === key), value: row?.value ?? null, updatedAt: row?.updated_at ?? null, updatedBy: row?.updated_by ?? null, history: history.rows });
  }
  const values: Record<string, unknown> = {};
  const updated: Record<string, { at: string; by: string }> = {};
  for (const r of rows.rows) {
    values[r.key] = r.value;
    updated[r.key] = { at: r.updated_at, by: r.updated_by };
  }
  return adminJson({ configured: true, keys: SETTING_KEYS, values, updated });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  const key = body.key;
  if (!isSettingKey(key)) return badRequest('unknown_key');
  if (!('value' in body)) return badRequest('value_required');
  const value = body.value === undefined ? null : body.value;
  resetSettingsMemo();
  const before = (await readSettings(env)).rows.find((r) => r.key === key)?.value ?? null;
  const w = await writeSetting(env, key, value, 'owner');
  if (!w.ok) return adminJson({ error: w.error, upstreamStatus: w.status }, w.error === 'too_large' ? 413 : w.error === 'unknown_key' ? 400 : 502);
  await audit({ action: 'settings', summary: value === null ? `cleared ${key}` : `published ${key}`, target: key, before, after: value });
  return adminJson({ ok: true, key, value: w.row?.value ?? null, updatedAt: w.row?.updated_at ?? null });
}, { cap: 80_000 });
