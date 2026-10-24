/**
 * GET /api/admin/ai?days= → { configured, days, summary, byFeature, byProvider, byModel, byDay, errors, recent }
 * VinaX AI usage from the ai_calls log (stats_ai).
 */
import { adminJson, dbFailure } from '../../_lib/admin';
import { adminGet } from '../../_lib/adminRoute';
import { db } from '../../_lib/db';
import { daysParam } from '../../_lib/edge';

export const onRequestGet = adminGet(async ({ env, url }) => {
  const days = daysParam(url, 7, 90);
  const r = await db.rpc<Record<string, unknown>>(env, 'stats_ai', { p_days: days });
  if (!r.ok) return dbFailure(r);
  const v = r.value && typeof r.value === 'object' ? r.value : {};
  return adminJson({
    configured: true,
    days,
    summary: v.summary ?? { total: 0, ok: 0, fail: 0, p50: null, p95: null, promptTokens: 0, completionTokens: 0 },
    byFeature: v.byFeature ?? [],
    byProvider: v.byProvider ?? [],
    byModel: v.byModel ?? [],
    byDay: v.byDay ?? [],
    errors: v.errors ?? [],
    recent: v.recent ?? [],
  });
});
