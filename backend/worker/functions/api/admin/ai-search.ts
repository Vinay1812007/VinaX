/**
 * Owner console — Test search (Health → VinaX AI).
 *
 *   POST /api/admin/ai-search { query?: "…", topic?: "general" | "news" }
 *     → { ok, provider: "tavily" | "serper", count, ms, status?, site?, reason? }
 *     reason: not_configured · daily_limit · failed · timeout · empty
 *
 * One real search through _lib/ai/search.ts, the way the chat makes one
 * (Tavily, or Serper when SEARCH_API_PROVIDER says so), so the owner can see
 * the key and the request shape work. The cache is skipped, and each press
 * takes one search from today's allowance (SEARCH_DAILY_LIMIT, or the
 * owner's searches a day in the `vinax-ai` setting) like any other search.
 * Editors and owners only, on a button press only. Never returns the key or
 * the provider's own words.
 */
import { adminJson, badRequest, requireRole, type AdminAuthEnv } from '../../_lib/admin';
import { readJsonCapped } from '../../_lib/body';
import { dbConfigured } from '../../_lib/db';
import { aiSettings, sanitizeAiSettings } from '../../_lib/ai/config';
import { testSearch } from '../../_lib/ai/search';
import type { AiEnv } from '../../_lib/ai/types';

type Env = AiEnv & AdminAuthEnv;

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  // A search spends the allowance: editors and owners only.
  const auth = await requireRole(request, env, 'editor');
  if (!auth.ok) return auth.response;
  const read = await readJsonCapped<{ query?: unknown; topic?: unknown } | null>(request, 4 * 1024);
  if (!read.ok) return badRequest();
  const b = read.value && typeof read.value === 'object' ? read.value : {};
  if (b.query != null && typeof b.query !== 'string') return badRequest();
  if (b.topic != null && b.topic !== 'general' && b.topic !== 'news') return badRequest();
  const settings = dbConfigured(env) ? await aiSettings(env) : sanitizeAiSettings(null);
  const r = await testSearch(env, { query: typeof b.query === 'string' ? b.query : undefined, topic: b.topic === 'news' ? 'news' : 'general', ownerCap: settings.limits.searchesPerDay });
  console.log(JSON.stringify({ route: 'admin-ai-search', provider: r.provider, ok: r.ok, ms: r.ms, count: r.count, reason: r.reason ?? null, status: r.status ?? null }));
  return adminJson(r);
};
