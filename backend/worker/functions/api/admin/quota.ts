/**
 * GET /api/admin/quota → the daily request meter (_lib/cfAnalytics.ts) for Server Checks.
 *
 *   { configured: false, missing: ['CF_ANALYTICS_TOKEN', …], allowance }      the two keys are not set
 *   { configured: true, requests, errors, subrequests, allowance, share, level, since, resetsAt,
 *     checkedAt, cached, byScript: [{ script, requests, errors }], byStatus: [{ status, requests }] }
 *   502 { configured: true, error: 'cf_unauthorized' | 'cf_timeout' | 'cf_failed', message }
 *
 * Any admin. Needs no database. The answer is at most ten minutes old (the
 * same cache Smart Alerts and the Dashboard read). Cloudflare's dataset has no
 * request path, so there is no "top addresses" list.
 */
import { adminJson } from '../../_lib/admin';
import { adminGet } from '../../_lib/adminRoute';
import { analyticsMissing, DAILY_REQUEST_ALLOWANCE, readRequestUsage, usageLevel, type CfAnalyticsEnv } from '../../_lib/cfAnalytics';

const MESSAGE: Record<string, string> = {
  unauthorized: 'Cloudflare refused the analytics key. It needs Account Analytics: Read, for the account in CF_ACCOUNT_ID.',
  timeout: 'Cloudflare analytics took too long to answer. Try again in a few minutes.',
  failed: 'Cloudflare analytics did not answer. Try again in a few minutes.',
};

export const onRequestGet = adminGet(async ({ env }) => {
  const missing = analyticsMissing(env);
  if (missing.length) return adminJson({ configured: false, missing, allowance: DAILY_REQUEST_ALLOWANCE });
  const r = await readRequestUsage(env as CfAnalyticsEnv);
  if (!r.ok) return adminJson({ configured: true, error: `cf_${r.reason}`, message: MESSAGE[r.reason] ?? MESSAGE.failed }, 502);
  return adminJson({ configured: true, ...r.usage, level: usageLevel(r.usage.share), cached: r.cached });
}, { withoutDb: true });
