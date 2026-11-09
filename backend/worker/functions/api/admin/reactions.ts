/**
 * The console's Song Reactions page (schema 19).
 *   GET /api/admin/reactions?days=30&limit=50
 *     → { configured, days, total, prevTotal, people, songs, byEmoji: [{ emoji, n }], top: [{ id, title, artist, image, language, total, counts }], byDay: [{ day, n }] }
 *     502 db_update_needed before version 19.
 */
import { adminJson, dbFailure } from '../../_lib/admin';
import { adminGet } from '../../_lib/adminRoute';
import { db } from '../../_lib/db';
import { intIn } from '../../_lib/edge';

export const onRequestGet = adminGet(async ({ env, url }) => {
  const days = intIn(url.searchParams.get('days'), 1, 365) ?? 30;
  const limit = intIn(url.searchParams.get('limit'), 1, 200) ?? 50;
  const r = await db.rpc<Record<string, unknown>>(env, 'stats_reactions', { p_days: days, p_limit: limit }, { timeoutMs: 30_000 });
  if (!r.ok) return dbFailure(r);
  return adminJson({ configured: true, ...(r.value ?? {}) });
});
