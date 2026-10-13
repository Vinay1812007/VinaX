/**
 * 11.9 — refresh the "Trending now" headlines (_lib/headlines.ts). Called every
 * three hours by .github/workflows/headlines.yml; protected by CRON_SECRET.
 * Two web searches a run at most, and none once today's searches reach 75 %
 * of SERPER_DAILY_LIMIT or the owner switches web-search off.
 */
import { refreshHeadlines } from '../../_lib/headlines';
import { safeEqual } from '../../_lib/safe-compare';
import type { SerperEnv } from '../../_lib/serper';

type Env = SerperEnv & { CRON_SECRET?: string };

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const onRequest = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env, waitUntil } = context;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const key = request.headers.get('x-cron-secret') ?? '';
  if (!env.CRON_SECRET || !safeEqual(key, env.CRON_SECRET)) return json({ error: 'unauthorized' }, 401);
  const out = await refreshHeadlines(env, waitUntil);
  // Disabled or capped is the owner's choice, not a failure of the job.
  if (!out.ok && (out.reason === 'disabled' || out.reason === 'not_configured' || out.reason === 'no_results')) return json({ ok: true, skipped: out.reason });
  return json(out, out.ok ? 200 : 502);
};
