/**
 * The console's Personal page: how the engine is doing.
 *
 *   GET  /api/admin/personal           → { configured, config, stats, embed: { model, configured }, composer: { candidates } }
 *   POST /api/admin/personal { action: 'embed' | 'colisten' }   run the backlog or the co-listening rebuild now
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { candidatesFor } from '../../_lib/ai/complete';
import type { AiEnv } from '../../_lib/ai/types';
import { db } from '../../_lib/db';
import { personalConfig } from '../../_lib/personal/config';
import { embedConfigured, runEmbedBacklog, runVerifyBacklog, type EmbedEnv } from '../../_lib/personal/embed';

export const onRequestGet = adminGet(async ({ env }) => {
  const config = await personalConfig(env);
  const [stats, candidates] = await Promise.all([
    db.rpc<Record<string, unknown>>(env, 'personal_stats'),
    candidatesFor(env as unknown as AiEnv, 'default').catch(() => []),
  ]);
  if (!stats.ok) return dbFailure(stats);
  return adminJson({
    configured: true,
    config,
    stats: stats.value,
    embed: { model: config.embedModel, configured: embedConfigured(env as unknown as EmbedEnv, config.embedModel) },
    composer: { enabled: config.composer, candidates: candidates.map((c) => c.id) },
  });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  const config = await personalConfig(env);
  if (body.action === 'embed') {
    const v = await runVerifyBacklog(env as unknown as EmbedEnv, 25);
    const r = await runEmbedBacklog(env as unknown as EmbedEnv, config.embedModel, 200);
    await audit({ action: 'personal.embed', summary: `verified ${v.verified}, dropped ${v.dropped}, embedded ${r.embedded}, backlog ${r.backlog}` });
    return adminJson({ ...r, verified: v.verified, dropped: v.dropped });
  }
  if (body.action === 'colisten') {
    const r = await db.rpc<Record<string, unknown>>(env, 'personal_refresh_colisten', { p_days: 30, p_cap: 50 });
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'personal.colisten', summary: `pairs ${String((r.value as { pairs?: unknown })?.pairs ?? '?')}` });
    return adminJson(r.value);
  }
  return badRequest('unknown_action');
});
