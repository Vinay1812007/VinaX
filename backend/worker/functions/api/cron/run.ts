/**
 * POST /api/cron/run { job } — run one scheduled job now.
 *
 * Authorised by `x-cron-secret: $CRON_SECRET` (a scheduler) or by the owner
 * console as an Owner (the console's "Run now"; jobs delete data and spend
 * quota, so viewers and editors cannot). Answers the run's summary. The Cron
 * Trigger itself needs neither: it calls runScheduled directly.
 */
import { requireRole, type AdminAuthEnv } from '../../_lib/admin';
import { readJsonCapped } from '../../_lib/body';
import { dbConfigured, type DbEnv } from '../../_lib/db';
import { isJobId, runJob } from '../../_lib/jobs';
import { safeEqual } from '../../_lib/safe-compare';

type Env = AdminAuthEnv & DbEnv & { CRON_SECRET?: string };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const onRequestGet = async (): Promise<Response> => json({ error: 'method_not_allowed' }, 405);

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const presented = request.headers.get('x-cron-secret') ?? '';
  const bySecret = !!env.CRON_SECRET && !!presented && safeEqual(presented, env.CRON_SECRET);
  if (!bySecret) {
    const auth = await requireRole(request, env, 'owner');
    if (!auth.ok) return auth.response;
  }
  if (!dbConfigured(env)) return json({ error: 'db_not_configured' }, 503);
  const read = await readJsonCapped<{ job?: unknown } | null>(request, 4_000);
  const job = read.ok ? read.value?.job : undefined;
  if (!isJobId(job)) return json({ error: 'unknown_job' }, 400);
  return json(await runJob(env, job));
};
