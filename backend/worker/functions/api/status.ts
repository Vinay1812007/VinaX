/**
 * Public status API — powers status.vinaxmusic.online.
 *
 * GET /api/status → the current state of every monitored component, probed
 *   live from this Worker (memoised a minute per isolate), plus the uptime
 *   history the scheduled status tick wrote (`uptime_days` / `uptime_latest`,
 *   read through `uptime_report`) and the owner's `status-note` setting.
 *
 * The API component is up by definition: this answer came from it (a Worker
 * cannot fetch its own routes). Nothing is recorded on a GET — the tick job
 * (_lib/jobs.ts) does the recording, so POST and PUT are honest 405s.
 */
import { db, dbConfigured, type DbEnv } from '../_lib/db';
import { asObject, clip } from '../_lib/edge';
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { setting } from '../_lib/settings';
import { catalogBases } from './cat/[[path]]';

const SITE = 'https://www.vinaxmusic.online';
export const WINDOW_DAYS = 90;
const MEMO_MS = 60_000;

export const COMPONENTS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'website', name: 'Website (www.vinaxmusic.online)' },
  { id: 'api', name: 'API & app services' },
  { id: 'catalog', name: 'Music catalog & search' },
  { id: 'admin', name: 'Admin console' },
];

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
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

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export interface Probe {
  ok: boolean;
  latency: number | null;
  checkedAt: string;
}

/** GET with a hard timeout; ok = 2xx/3xx. Never throws. */
async function probeUrl(url: string): Promise<Probe> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9_000) });
    try { await res.body?.cancel(); } catch { /* body already used/absent */ }
    return { ok: res.status < 400, latency: Date.now() - t0, checkedAt: new Date().toISOString() };
  } catch {
    return { ok: false, latency: null, checkedAt: new Date().toISOString() };
  }
}

let memo: { at: number; probes: Map<string, Probe> } | null = null;

/** Tests only. */
export function resetStatusMemo(): void {
  memo = null;
}

/** Every component probed once (memoised MEMO_MS); the status tick job calls this too. */
export async function probeAll(now = Date.now(), fresh = false): Promise<Map<string, Probe>> {
  if (!fresh && memo && now - memo.at < MEMO_MS) return memo.probes;
  const [website, catalog, admin] = await Promise.all([
    probeUrl(SITE + '/'),
    // The /api/cat/* route forwards to the CATALOG_UPSTREAMS wrapper — probe
    // that (probing our own route would be a recursive subrequest).
    catalogBases()[0] ? probeUrl(`${catalogBases()[0]}/search/songs?query=love&limit=1`) : Promise.resolve<Probe>({ ok: false, latency: null, checkedAt: new Date(now).toISOString() }),
    probeUrl(SITE + '/admin/'),
  ]);
  const probes = new Map<string, Probe>([
    ['website', website],
    ['api', { ok: true, latency: null, checkedAt: new Date(now).toISOString() }],
    ['catalog', catalog],
    ['admin', admin],
  ]);
  memo = { at: now, probes };
  return probes;
}

interface UptimeRow {
  component: string;
  ok: boolean | null;
  latencyMs: number | null;
  checkedAt: string | null;
  uptime: number | null;
  days: Array<{ day: string; up: number; total: number }>;
}

/** The recorded history per component; empty when there is no database or the read failed. */
async function history(env: DbEnv): Promise<Map<string, UptimeRow>> {
  const out = new Map<string, UptimeRow>();
  if (!dbConfigured(env)) return out;
  const r = await db.rpc<UptimeRow[]>(env, 'uptime_report', { p_days: WINDOW_DAYS });
  if (!r.ok || !Array.isArray(r.value)) return out;
  for (const row of r.value) if (row && typeof row.component === 'string') out.set(row.component, row);
  return out;
}

export const onRequestGet = async (context: { request: Request; env?: DbEnv }): Promise<Response> => {
  const limited = rateLimit(context.request, 'status', { capacity: 30, refillPerMinute: 20 });
  if (limited) return limited;
  const env = context.env ?? {};
  const [probes, past, noteValue] = await Promise.all([probeAll(Date.now()), history(env), setting(env, 'status-note')]);
  const components = COMPONENTS.map((c) => {
    const p = probes.get(c.id);
    const h = past.get(c.id);
    return {
      id: c.id,
      name: c.name,
      status: !p ? 'unknown' : p.ok ? 'up' : 'down',
      latencyMs: p?.latency ?? null,
      checkedAt: p?.checkedAt ?? null,
      uptime90: typeof h?.uptime === 'number' ? h.uptime : null,
      days: Array.isArray(h?.days) ? h.days.filter((d) => d && typeof d.day === 'string').map((d) => ({ day: d.day.slice(0, 10), up: Number(d.up) || 0, total: Number(d.total) || 0 })) : [],
    };
  });
  const allUp = components.every((c) => c.status === 'up');
  const anyDown = components.some((c) => c.status === 'down');
  const note = clip(asObject(noteValue)?.text, 500);
  return json(
    {
      generatedAt: new Date().toISOString(),
      windowDays: WINDOW_DAYS,
      overall: allUp ? 'operational' : anyDown ? 'outage' : 'unknown',
      note,
      components,
    },
    200,
    60,
  );
};

/** Nothing is recorded on a request: POST and PUT are honest 405s (the tick job records). */
export const onRequestPost = async (): Promise<Response> => methodNotAllowed('GET, OPTIONS');
export const onRequestPut = async (): Promise<Response> => methodNotAllowed('GET, OPTIONS');
