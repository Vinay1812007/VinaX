/**
 * System health: live-checks the AI keys (tiny 4-token ping, each against its
 * OWN provider endpoint) and Supabase write freshness, so an outage shows its
 * exact cause instead of guesswork. Admin-gated because each check spends a
 * few model tokens.
 *
 * 10.3 — one key per provider, so `ai` is four rows (NVIDIA, OpenRouter,
 * Groq, Gemini), each pinging the model its lane would use right now and
 * naming the lanes that sign with it. `lanes` adds per-lane success over the
 * trailing 24 h of vinax_ai_events (calls, ok %, latency, failover hops), with
 * each lane's provider and whether its key is set — so a lane that degrades
 * while its key still pings fine is visible too.
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { dbErrorCode, sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';
import { AI_PROVIDERS, LANE_MODEL, LANE_PROVIDER, PROVIDER_ENV, PROVIDER_LABEL, PROVIDER_LANE, isMaestroEndpoint, isRefusalCode, laneEndpoint, laneModel, type AiEnv, type AiProvider, type Lane } from '../../_lib/ai';
import { maestroFetch } from '../../_lib/maestro';
import { catalogDefaultModel } from '../../_lib/catalog';
import { aggregateLaneHealth, type AiEventRow, type LaneHealth } from '../../_lib/laneHealth';

type Env = AdminEnv & SupabaseEnv & AiEnv;

interface KeyHealth {
  key: string;
  /** 10.3 — the provider this key belongs to, its secret name and the lanes it signs. */
  provider?: AiProvider;
  env?: string;
  lanes?: Lane[];
  configured: boolean;
  ok: boolean;
  status: number | null;
  model: string | null;
  note: string | null;
}

async function pingKey(name: string, key: string | undefined, model: string, base: string): Promise<KeyHealth> {
  if (!key) return { key: name, configured: false, ok: false, status: null, model: null, note: 'not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const ping = { model, max_tokens: 4, messages: [{ role: 'user', content: 'ping' }] };
    const res = isMaestroEndpoint(base)
      ? await maestroFetch(key, model, ping, controller.signal)
      : await fetch(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify(ping),
          signal: controller.signal,
        });
    // Audit finding M-SRV-5: the previous line dropped up to 180 bytes of the
    // raw upstream body straight into the admin JSON — some providers echo the
    // bearer key or internal stack lines in their 4xx bodies. A sanitized
    // status token is enough for triage.
    const note: string | null = res.ok ? null : `${res.status}:${model}`;
    return { key: name, configured: true, ok: res.ok, status: res.status, model, note };
  } catch {
    return { key: name, configured: true, ok: false, status: null, model, note: 'network error / timeout' };
  } finally {
    clearTimeout(timer);
  }
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  // 4 live model pings per call — cap the frequency so a stuck 10s auto-
  // refresh loop can't burn upstream quota (audit: unthrottled).
  const limited = await rateLimitAsync(request, 'admin-health', { capacity: 4, refillPerMinute: 2 }, env);
  if (limited) return limited;
  // Each key is pinged with the model its lane would ACTUALLY use right now.
  // The Groq and OpenRouter lanes serve a moving catalogue, so their model
  // comes from the live free list — a fixed pin here reported a 404 that
  // said nothing about whether the key works.
  const lanesOf = (p: AiProvider): Lane[] => (Object.keys(LANE_PROVIDER) as Lane[]).filter((l) => LANE_PROVIDER[l] === p);
  const pingModel = async (p: AiProvider): Promise<string> => {
    const lane = PROVIDER_LANE[p];
    if (lane === 'scholar' || lane === 'router') return (await catalogDefaultModel(env, p)) ?? LANE_MODEL[lane];
    return laneModel(env, lane);
  };
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [keyRows, lastEvents, aiEvents] = await Promise.all([
    Promise.all(
      AI_PROVIDERS.map(async (p): Promise<KeyHealth> => {
        const lanes = lanesOf(p);
        const row = await pingKey(`${PROVIDER_LABEL[p]} · ${lanes.join(', ')}`, env[PROVIDER_ENV[p]], await pingModel(p), laneEndpoint(env, PROVIDER_LANE[p]));
        return { ...row, provider: p, env: PROVIDER_ENV[p], lanes };
      }),
    ),
    sbSelectResult<{ created_at?: string }>(env, 'vinax_events', 'select=created_at&order=created_at.desc&limit=1'),
    supabaseConfigured(env)
      ? sbSelectResult<AiEventRow>(env, 'vinax_ai_events', `created_at=gte.${encodeURIComponent(since)}&select=model,ok,status,error,latency_ms&order=created_at.desc&limit=10000`)
      : Promise.resolve(null),
  ]);
  // 10.3 — per-lane success over 24 h. Refused calls (owner AI controls)
  // reached no lane and are left out; an idle lane shows zero calls.
  const measured = aiEvents && aiEvents.ok ? aggregateLaneHealth(aiEvents.rows.filter((r) => !isRefusalCode(r.error))) : [];
  const idle = (lane: string): LaneHealth => ({ lane, calls: 0, okPct: 0, p50: null, p95: null, p99: null, hops: 0, emptyStreams: 0, authErrors: 0 });
  const lanes = (Object.keys(LANE_PROVIDER) as Lane[]).map((lane) => ({
    ...(measured.find((m) => m.lane === lane) ?? idle(lane)),
    provider: LANE_PROVIDER[lane],
    keySet: Boolean(env[PROVIDER_ENV[LANE_PROVIDER[lane]]]),
  }));
  // 7.2.0 — the database half of this panel names its failure instead of
  // guessing between "paused, empty or failing"; the AI pings stay useful.
  const lastEventAt = lastEvents.ok && lastEvents.rows.length ? (lastEvents.rows[0].created_at ?? null) : null;
  const dbReadable = lastEvents.ok;
  const dbError = lastEvents.ok ? null : dbErrorCode(lastEvents.error);
  return new Response(
    JSON.stringify({
      time: new Date().toISOString(),
      ai: keyRows,
      lanes,
      lanesReadable: aiEvents ? aiEvents.ok : false,
      supabase: {
        configured: supabaseConfigured(env),
        readable: dbReadable,
        error: dbError,
        upstreamStatus: lastEvents.ok ? null : lastEvents.httpStatus,
        lastEventAt,
        note: lastEventAt
          ? null
          : !supabaseConfigured(env)
            ? 'Database not configured.'
            : !lastEvents.ok
              ? `Unavailable — the events read failed (${dbError}${lastEvents.httpStatus ? `, HTTP ${lastEvents.httpStatus}` : ''}).`
              : 'The events table is readable but empty — no event has been written yet.',
      },
      unavailable: supabaseConfigured(env) && !dbReadable ? ['supabase'] : [],
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
