/**
 * Public status API + self-probing tick — powers status.sirimillavinay.online.
 *
 * GET  /api/status → current state of every monitored component plus 90 days
 *   of daily uptime bars (from Supabase uptime_daily / uptime_last).
 * POST /api/status → runs the probes SERVER-SIDE and records the results.
 *   Called by the status-tick GitHub Action every 30 minutes. Deliberately
 *   unauthenticated: a caller only *triggers* a probe round — every result
 *   is measured here, never taken from the request — so a stranger can at
 *   worst spend one rate-limited probe round.
 *
 * The API component carries no live probe on purpose: a Worker cannot fetch
 * its own routes (recursive-subrequest block), so each successful tick
 * records the API as up, and the reader marks it down when ticks stop
 * arriving (stale uptime_last) — which is exactly what an API outage or a
 * dead scheduler looks like from outside.
 */
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { sbCount, sbSelect, sbUpsert, supabaseConfigured, type SupabaseEnv } from '../_lib/supabase';

const SITE = 'https://www.sirimillavinay.online';
/** A tick is expected every 30 min; past this gap a component reads unknown/down. */
const STALE_MS = 95 * 60_000;
const WINDOW_DAYS = 90;

const COMPONENTS: Array<{ id: string; name: string }> = [
  { id: 'website', name: 'Website (www.sirimillavinay.online)' },
  { id: 'api', name: 'API & app services' },
  { id: 'catalog', name: 'Music catalog & search' },
  { id: 'database', name: 'Database (config & profiles)' },
  { id: 'admin', name: 'Admin console' },
];

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(body: unknown, status = 200, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
      ...CORS,
    },
  });
}

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

interface ProbeResult {
  id: string;
  ok: boolean;
  latency: number | null;
}

/** GET with a hard timeout; ok = 2xx/3xx. Never throws. */
async function probeUrl(url: string, init?: RequestInit): Promise<{ ok: boolean; latency: number | null }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      redirect: 'follow',
      signal: AbortSignal.timeout(9_000),
    });
    // Read a little of the body so a black-holed response can't fake a 200.
    try { await res.body?.cancel(); } catch { /* body already used/absent */ }
    return { ok: res.status < 400, latency: Date.now() - t0 };
  } catch {
    return { ok: false, latency: null };
  }
}

async function runProbes(env: SupabaseEnv): Promise<ProbeResult[]> {
  const [website, admin, catalog, dbCount] = await Promise.all([
    probeUrl(SITE + '/'),
    probeUrl(SITE + '/admin/'),
    // The /api/cat/* catalog route proxies JioSaavn — probe the upstream the
    // route depends on (probing our own route would be a recursive subrequest).
    probeUrl('https://www.jiosaavn.com/api.php?__call=autocomplete.get&query=love&_format=json&_marker=0&ctx=web6dot0'),
    (async () => {
      const t0 = Date.now();
      const n = await sbCount(env, 'vinax_config');
      return { ok: n !== null, latency: n !== null ? Date.now() - t0 : null };
    })(),
  ]);
  return [
    { id: 'website', ok: website.ok, latency: website.latency },
    // The tick itself ran through the API — that IS the API probe.
    { id: 'api', ok: true, latency: null },
    { id: 'catalog', ok: catalog.ok, latency: catalog.latency },
    { id: 'database', ok: dbCount.ok, latency: dbCount.latency },
    { id: 'admin', ok: admin.ok, latency: admin.latency },
  ];
}

/** POST — probe everything and record one tick. */
export const onRequestPost = async (context: { request: Request; env: SupabaseEnv }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'status-tick', { capacity: 6, refillPerMinute: 1 });
  if (limited) return limited;
  if (!supabaseConfigured(env)) return json({ error: 'not_configured' }, 503);

  const results = await runProbes(env);
  const now = new Date().toISOString();
  const day = now.slice(0, 10); // UTC day — the whole page reports in UTC days

  // Existing daily rows in one read, then merge-upsert the incremented counts.
  const existing = await sbSelect<{ component: string; up: number; total: number }>(
    env,
    'uptime_daily',
    `select=component,up,total&day=eq.${day}`,
  );
  const byComp = new Map(existing.map((r) => [r.component, r]));
  let wrote = 0;
  for (const r of results) {
    const prev = byComp.get(r.id);
    const okDaily = await sbUpsert(
      env,
      'uptime_daily',
      { component: r.id, day, up: (prev?.up ?? 0) + (r.ok ? 1 : 0), total: (prev?.total ?? 0) + 1 },
      'component,day',
    );
    const okLast = await sbUpsert(
      env,
      'uptime_last',
      { component: r.id, ok: r.ok, latency_ms: r.latency, checked_at: now },
      'component',
    );
    if (okDaily && okLast) wrote += 1;
  }
  return json({ ok: true, recorded: wrote, results });
};

/** GET — everything the status page needs, cached a minute at the edge. */
export const onRequestGet = async (context: { request: Request; env: SupabaseEnv }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'status', { capacity: 30, refillPerMinute: 20 });
  if (limited) return limited;

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const configured = supabaseConfigured(env);
  const [daily, last] = configured
    ? await Promise.all([
        sbSelect<{ component: string; day: string; up: number; total: number }>(
          env,
          'uptime_daily',
          `select=component,day,up,total&day=gte.${since}&order=day.asc&limit=2000`,
        ),
        sbSelect<{ component: string; ok: boolean; latency_ms: number | null; checked_at: string }>(
          env,
          'uptime_last',
          'select=component,ok,latency_ms,checked_at&limit=50',
        ),
      ])
    : [[], []];

  const lastBy = new Map(last.map((r) => [r.component, r]));
  const dailyBy = new Map<string, Array<{ day: string; up: number; total: number }>>();
  for (const r of daily) {
    const list = dailyBy.get(r.component) ?? [];
    list.push({ day: r.day, up: r.up, total: r.total });
    dailyBy.set(r.component, list);
  }

  const components = COMPONENTS.map((c) => {
    const days = dailyBy.get(c.id) ?? [];
    const sumUp = days.reduce((a, d) => a + d.up, 0);
    const sumTotal = days.reduce((a, d) => a + d.total, 0);
    const l = lastBy.get(c.id);
    const fresh = l ? Date.now() - Date.parse(l.checked_at) < STALE_MS : false;
    const status: 'up' | 'down' | 'unknown' = !l ? 'unknown' : !fresh ? (c.id === 'api' ? 'down' : 'unknown') : l.ok ? 'up' : 'down';
    return {
      id: c.id,
      name: c.name,
      status,
      latencyMs: l && fresh ? l.latency_ms : null,
      checkedAt: l ? l.checked_at : null,
      uptime90: sumTotal > 0 ? Math.round((sumUp / sumTotal) * 10000) / 100 : null,
      days,
    };
  });
  const allUp = components.every((c) => c.status === 'up');
  const anyDown = components.some((c) => c.status === 'down');
  return json(
    {
      generatedAt: new Date().toISOString(),
      windowDays: WINDOW_DAYS,
      overall: allUp ? 'operational' : anyDown ? 'outage' : 'unknown',
      components,
    },
    200,
    60,
  );
};

/** Anything else: honest 405. */
export const onRequestPut = async (): Promise<Response> => methodNotAllowed();
