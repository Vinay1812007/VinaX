/**
 * POST /api/cron/trends-ingest — the scheduled trend ingestion.
 *
 * Called by .github/workflows/trends-ingest.yml every six hours with the
 * `x-cron-secret` header (header only, constant-time compare, like every
 * other /api/cron/* route). Optional `?source=<id>&region=<CC>` narrow one
 * run. Runs every configured provider × region (see _lib/trends/ingest.ts):
 * bounded retries with jitter, per-provider quota accounting against a daily
 * ceiling, one run record per provider and region, then deletes what is past
 * its retention window.
 *
 * Answers 200 with the per-run summary when every attempted run succeeded,
 * 502 when any run failed (so the workflow's retry and failure issue fire),
 * 503 when the database is not configured. Providers that are disabled or
 * not configured are listed as `notRun`, which is not a failure.
 */
import { safeEqual } from '../../_lib/safe-compare';
import { runIngest } from '../../_lib/trends/ingest';
import { providerById } from '../../_lib/trends/registry';
import { REGION_RE, type TrendsEnv } from '../../_lib/trends/types';
import { supabaseConfigured } from '../../_lib/supabase';

type Env = TrendsEnv & { CRON_SECRET?: string };

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const key = request.headers.get('x-cron-secret') ?? '';
  if (!env.CRON_SECRET || !safeEqual(key, env.CRON_SECRET)) return json({ error: 'unauthorized' }, 401);
  if (!supabaseConfigured(env)) return json({ error: 'db_not_configured' }, 503);

  const url = new URL(request.url);
  const source = (url.searchParams.get('source') ?? '').trim().toLowerCase();
  const region = (url.searchParams.get('region') ?? '').trim().toUpperCase();
  if (source && !providerById(source)) return json({ error: 'unknown_source' }, 400);
  if (region && !REGION_RE.test(region)) return json({ error: 'bad_region' }, 400);

  const result = await runIngest(env, { sources: source ? [source] : undefined, regions: region ? [region] : undefined, trigger: 'cron', prune: true });
  return json(result, result.ok ? 200 : 502);
};
