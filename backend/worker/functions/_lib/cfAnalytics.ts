/**
 * The daily request meter: how many Worker requests the account has used
 * since 00:00 UTC, against the free plan's daily allowance (README,
 * "The daily request quota"). When the allowance is spent the platform stops
 * running the Worker until 00:00 UTC (05:30 India time) and every /api/* call
 * fails with its error 1027, so the console shows the meter (Server Checks,
 * the Dashboard) and Smart Alerts warns before it runs out (`quotaHigh`).
 *
 * Source: Cloudflare's GraphQL Analytics API
 *   POST https://api.cloudflare.com/client/v4/graphql   Authorization: Bearer CF_ANALYTICS_TOKEN
 *   viewer.accounts(accountTag: CF_ACCOUNT_ID).workersInvocationsAdaptive
 *     filter datetime_geq <today 00:00 UTC>, datetime_leq <now>
 *     sum { requests errors subrequests }   dimensions { scriptName status }
 * The token needs only Account > Account Analytics > Read. The dataset is
 * grouped by the dimensions asked for, so the answer is one row per
 * (Worker, outcome) pair: the total, a per-Worker split and a per-outcome
 * split (status: success, scriptThrewException, exceededResources,
 * clientDisconnected, …). It has no request path, so the meter cannot say
 * which addresses used the requests (Cloudflare's dashboard can).
 *
 * The allowance is per account, across every Worker on it, so the total is
 * the account's, not only this Worker's. Analytics lag the live count by a
 * minute or two.
 *
 * Cached ten minutes, in this instance's memory and the edge cache
 * (`caches.default`, as `ai/discovery.ts` does), so the Dashboard, Server
 * Checks and the 5-minute alert check share one query. A failed query is
 * remembered for two minutes so a broken key is not asked every request.
 * Never throws.
 */

/** The free plan's Worker requests per day, for the whole account. */
export const DAILY_REQUEST_ALLOWANCE = 100_000;
/** The Dashboard warns from this share of the allowance (Smart Alerts has its own setting). */
export const REQUESTS_WARN_SHARE = 0.8;
/** … and calls it urgent from this one. */
export const REQUESTS_BAD_SHARE = 0.95;
export const USAGE_CACHE_MS = 10 * 60_000;
export const USAGE_RETRY_MS = 2 * 60_000;
export const USAGE_FETCH_MS = 8_000;
export const CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

export interface CfAnalyticsEnv {
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
}

export const ANALYTICS_KEYS = ['CF_ANALYTICS_TOKEN', 'CF_ACCOUNT_ID'] as const;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The analytics keys that are not set. */
export function analyticsMissing(env: unknown): string[] {
  const e = (env ?? {}) as Record<string, unknown>;
  return ANALYTICS_KEYS.filter((k) => !str(e[k]));
}

export const analyticsConfigured = (env: unknown): boolean => analyticsMissing(env).length === 0;

export interface RequestUsage {
  /** Worker requests since `since`, every Worker on the account. */
  requests: number;
  /** Of those, the ones that ended in an error (the script threw, ran out of CPU, …). */
  errors: number;
  subrequests: number;
  allowance: number;
  /** requests ÷ allowance (may pass 1). */
  share: number;
  /** 00:00 UTC today. */
  since: string;
  /** When the allowance starts again (00:00 UTC tomorrow). */
  resetsAt: string;
  /** When Cloudflare was asked. */
  checkedAt: string;
  byScript: Array<{ script: string; requests: number; errors: number }>;
  byStatus: Array<{ status: string; requests: number }>;
}

export type UsageResult =
  | { ok: true; usage: RequestUsage; cached: boolean }
  | { ok: false; reason: 'not_configured' | 'unauthorized' | 'timeout' | 'failed' };

const DAY_MS = 86_400_000;
/** 00:00 UTC of the day `now` falls in. */
export const utcDayStart = (now: number): number => Math.floor(now / DAY_MS) * DAY_MS;
export const utcDay = (now: number): string => new Date(utcDayStart(now)).toISOString().slice(0, 10);

export const QUERY = `query VinaxRequestMeter($accountTag: string, $since: string, $until: string) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $since, datetime_leq: $until }, orderBy: [sum_requests_DESC]) {
        sum { requests errors subrequests }
        dimensions { scriptName status }
      }
    }
  }
}`;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The GraphQL answer → the meter (pure). null when the answer has no account rows at all. */
export function usageFrom(json: unknown, now: number, allowance = DAILY_REQUEST_ALLOWANCE): RequestUsage | null {
  const accounts = obj(obj(obj(json).data).viewer).accounts;
  if (!Array.isArray(accounts) || !accounts.length) return null;
  const rows = obj(accounts[0]).workersInvocationsAdaptive;
  if (!Array.isArray(rows)) return null;
  let requests = 0, errors = 0, subrequests = 0;
  const scripts = new Map<string, { requests: number; errors: number }>();
  const statuses = new Map<string, number>();
  for (const raw of rows) {
    const sum = obj(obj(raw).sum), dim = obj(obj(raw).dimensions);
    const r = num(sum.requests), e = num(sum.errors);
    requests += r; errors += e; subrequests += num(sum.subrequests);
    const script = str(dim.scriptName) || 'unknown';
    const s = scripts.get(script) ?? { requests: 0, errors: 0 };
    s.requests += r; s.errors += e;
    scripts.set(script, s);
    const status = str(dim.status) || 'unknown';
    statuses.set(status, (statuses.get(status) ?? 0) + r);
  }
  const start = utcDayStart(now);
  return {
    requests, errors, subrequests, allowance,
    share: allowance > 0 ? requests / allowance : 0,
    since: new Date(start).toISOString(),
    resetsAt: new Date(start + DAY_MS).toISOString(),
    checkedAt: new Date(now).toISOString(),
    byScript: [...scripts.entries()].map(([script, v]) => ({ script, ...v })).sort((a, b) => b.requests - a.requests).slice(0, 10),
    byStatus: [...statuses.entries()].map(([status, r]) => ({ status, requests: r })).sort((a, b) => b.requests - a.requests),
  };
}

/** 'ok' | 'warn' (≥ 80 %) | 'bad' (≥ 95 %). */
export const usageLevel = (share: number): 'ok' | 'warn' | 'bad' => (share >= REQUESTS_BAD_SHARE ? 'bad' : share >= REQUESTS_WARN_SHARE ? 'warn' : 'ok');

/* ------------------------------------------------------------------ cache */

type Memo = { key: string; at: number; result: UsageResult };
let memo: Memo | null = null;
/** Tests: forget the remembered answer. */
export function resetUsageMemo(): void { memo = null; }

const edgeKey = (account: string, day: string): string => `https://vinax-request-meter.internal/v1/${encodeURIComponent(account)}/${day}`;
const edgeCache = (): Cache | null => (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;

async function fromEdge(key: string, now: number): Promise<RequestUsage | null> {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(key);
    if (!hit) return null;
    const v = obj(await hit.json()) as unknown as RequestUsage;
    const at = Date.parse(String(v.checkedAt));
    if (!Number.isFinite(at) || now - at >= USAGE_CACHE_MS || typeof v.requests !== 'number') return null;
    return v;
  } catch {
    return null;
  }
}

async function toEdge(key: string, usage: RequestUsage): Promise<void> {
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.put(key, new Response(JSON.stringify(usage), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Math.floor(USAGE_CACHE_MS / 1000)}` },
    }));
  } catch { /* caching is best-effort */ }
}

/** Ask Cloudflare (no cache). */
async function query(env: CfAnalyticsEnv, now: number, timeoutMs: number): Promise<UsageResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(CF_GRAPHQL_URL, {
      method: 'POST',
      signal: ac.signal,
      headers: { authorization: `Bearer ${str(env.CF_ANALYTICS_TOKEN)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { accountTag: str(env.CF_ACCOUNT_ID), since: new Date(utcDayStart(now)).toISOString(), until: new Date(now).toISOString() } }),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized' };
    if (!res.ok) return { ok: false, reason: 'failed' };
    const json = obj(await res.json().catch(() => null));
    const errors = Array.isArray(json.errors) ? json.errors : [];
    if (errors.length && !obj(json.data).viewer) {
      const text = errors.map((e) => str(obj(e).message)).join(' ').toLowerCase();
      return { ok: false, reason: /auth|permission|access|not allowed|token/.test(text) ? 'unauthorized' : 'failed' };
    }
    const usage = usageFrom(json, now);
    // No account rows: the token cannot see this account (a wrong CF_ACCOUNT_ID).
    if (!usage) return { ok: false, reason: errors.length ? 'failed' : 'unauthorized' };
    return { ok: true, usage, cached: false };
  } catch {
    return { ok: false, reason: ac.signal.aborted ? 'timeout' : 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Today's request meter, from the cache when it is under ten minutes old.
 * `timeoutMs` bounds the Cloudflare call (the Dashboard waits less).
 */
export async function readRequestUsage(env: CfAnalyticsEnv, now = Date.now(), o: { timeoutMs?: number } = {}): Promise<UsageResult> {
  if (!analyticsConfigured(env)) return { ok: false, reason: 'not_configured' };
  const key = edgeKey(str(env.CF_ACCOUNT_ID), utcDay(now));
  if (memo && memo.key === key && now - memo.at < (memo.result.ok ? USAGE_CACHE_MS : USAGE_RETRY_MS)) {
    return memo.result.ok ? { ...memo.result, cached: true } : memo.result;
  }
  const edge = await fromEdge(key, now);
  if (edge) {
    const result: UsageResult = { ok: true, usage: edge, cached: true };
    memo = { key, at: Date.parse(edge.checkedAt), result };
    return result;
  }
  const timeoutMs = o.timeoutMs ?? USAGE_FETCH_MS;
  const result = await query(env, now, timeoutMs);
  // A caller that waits less (the Dashboard) timing out says nothing about the
  // full wait: do not make Server Checks and Smart Alerts skip the next two minutes.
  if (result.ok || result.reason !== 'timeout' || timeoutMs >= USAGE_FETCH_MS) memo = { key, at: now, result };
  if (result.ok) await toEdge(key, result.usage);
  else console.log(JSON.stringify({ route: 'request-meter', ok: false, reason: result.reason }));
  return result;
}
