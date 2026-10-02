/**
 * System health: live-checks the nine AI lanes that drive features (tiny
 * 4-token ping, each against its OWN lane endpoint — providers are mixed) and
 * Supabase write freshness, so an outage shows its exact cause instead of
 * guesswork. Admin-gated because each check spends a few model tokens.
 *
 * v5.21.0 — re-pointed at the owner's rotated secrets, and widened to cover
 * the two seats that arrived with them: the free-model marketplace and the
 * vision key. The bench-only inventory lanes stay out; the AI Lab probes
 * those one at a time.
 *
 * 9.0.1 — plus one row for the owner's web search instance (SEARXNG_URL): a
 * cheap query, reported as reachable / result count / latency. The row never
 * carries the instance's address or token. It matters more than it did in
 * 8.3.0: the instance is now the ONLY web search source, so this row is where
 * "VinaX AI can't check the web" shows up before a listener reports it.
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { dbErrorCode, sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';
import { LANE_MODEL, isMaestroEndpoint, laneEndpoint, laneModel, type AiEnv } from '../../_lib/ai';
import { maestroFetch } from '../../_lib/maestro';
import { catalogDefaultModel } from '../../_lib/catalog';
import { searxngConfigured, searxngCoolingRemainingMs, searxngLastFailure, searxngQuery, searxngUrlSet, type SearxngEnv } from '../../_lib/searxng';

type Env = AdminEnv & SupabaseEnv & AiEnv & SearxngEnv;

const SEARCH_ROW = 'Web search engine · VinaX AI research · Search expert';

/** Reachability of the web search instance, in the same row shape as the AI keys. Exported for tests. */
export async function pingSearch(env: SearxngEnv): Promise<KeyHealth> {
  if (!searxngConfigured(env)) {
    // Set but refused by the Worker: say so, instead of "not configured".
    const note = searxngUrlSet(env) ? 'invalid address — SEARXNG_URL must be https:// (http only for localhost), with no user name, password or query' : 'not configured — VinaX AI cannot check the live web';
    return { key: SEARCH_ROW, configured: searxngUrlSet(env), ok: false, status: null, model: null, note };
  }
  const r = await searxngQuery(env, 'telugu songs', { categories: 'general', limit: 5, timeoutMs: 6_000, tag: 'health' });
  if (r.ok) {
    const note = r.results.length ? `${r.results.length} results · ${r.latencyMs} ms${r.unresponsive.length ? ` · ${r.unresponsive.length} engine(s) down` : ''}` : `reachable but no results · ${r.latencyMs} ms`;
    return { key: SEARCH_ROW, configured: true, ok: r.results.length > 0, status: r.httpStatus, model: null, note };
  }
  if (r.status === 'cooling') {
    const cause = searxngLastFailure();
    const mins = Math.max(1, Math.ceil(searxngCoolingRemainingMs() / 60_000));
    const why = cause ? searchFailureNote(cause.status, cause.httpStatus) : 'a recent failure';
    return { key: SEARCH_ROW, configured: true, ok: false, status: cause?.httpStatus ?? null, model: null, note: `resting after ${why} (retries in about ${mins} min)` };
  }
  return { key: SEARCH_ROW, configured: true, ok: false, status: r.httpStatus, model: null, note: searchFailureNote(r.status, r.httpStatus) };
}

/** Plain words for a failed search call. Pure; exported for tests. */
export function searchFailureNote(status: string, httpStatus: number | null): string {
  if (status === 'http_error') {
    if (httpStatus === 401) return 'token refused — check SEARXNG_TOKEN';
    if (httpStatus === 403) return 'forbidden — check that search.formats in settings.yml includes json';
    if (httpStatus === 429) return 'rate limited by the instance';
    return `error answer${httpStatus ? ` (HTTP ${httpStatus})` : ''}`;
  }
  const why: Record<string, string> = {
    timeout: 'timed out',
    network: 'network error',
    bad_json: 'the answer was not JSON — check the address and the proxy in front of the instance',
    too_large: 'the answer was too large',
  };
  return why[status] ?? status;
}

interface KeyHealth {
  key: string;
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
  // 9 live model pings per call — cap the frequency so a stuck 10s auto-
  // refresh loop can't burn upstream quota (audit: unthrottled).
  const limited = await rateLimitAsync(request, 'admin-health', { capacity: 4, refillPerMinute: 2 }, env);
  if (limited) return limited;
  // The two catalog lanes serve a moving catalog, so health must ping the
  // model they would ACTUALLY use right now — a fixed pin here reported a
  // 404 that said nothing about whether the key works.
  const [scholarModel, routerModel] = await Promise.all([
    catalogDefaultModel(env, 'grq'),
    catalogDefaultModel(env, 'opr'),
  ]);
  const [maestro, dj, chat, sage, swift, scholar, home, search, router, vision, lastEvents, webSearch] = await Promise.all([
    pingKey('VinaX Maestro · DJ · Queue Builder · Home builder', env.VINAX_GGL_GEMINI_API_KEY, laneModel(env, 'maestro'), laneEndpoint(env, 'maestro')),
    pingKey('VinaX LTNG · chat · playlists', env.VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B, LANE_MODEL.dj, laneEndpoint(env, 'dj')),
    pingKey('VinaX Balanced · chat · playlists', env.VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B, LANE_MODEL.chat, laneEndpoint(env, 'chat')),
    pingKey('VinaX NMTRN SUP · deep reasoning', env.VINAX_NVD_NEMOTRON_3_SUPER_120B_A12B, LANE_MODEL.deep, laneEndpoint(env, 'deep')),
    pingKey('VinaX OSS 20B · fast answers', env.VINAX_OAI_GPT_OSS_20B, LANE_MODEL.fast, laneEndpoint(env, 'fast')),
    pingKey('VinaX GRQ ALL · music knowledge · live voice', env.VINAX_GROQ_API_KEY, scholarModel ?? LANE_MODEL.scholar, laneEndpoint(env, 'scholar')),
    pingKey('VinaX NMTRN ULT · premium reasoning', env.VINAX_NVD_NEMOTRON_3_ULTRA_550B_A55B, LANE_MODEL.home, laneEndpoint(env, 'home')),
    pingKey('VinaX NMTRN NN OMNI · search music expert', env.VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING, LANE_MODEL.search, laneEndpoint(env, 'search')),
    pingKey('VinaX OPR ALL · free model marketplace', env.VINAX_OPENROUTER_API_KEY, routerModel ?? LANE_MODEL.router, laneEndpoint(env, 'router')),
    pingKey('VinaX VSN 11B · image understanding', env.VINAX_MTA_LMA_3_2_11B_VSN_INT, LANE_MODEL.vision, laneEndpoint(env, 'vision')),
    sbSelectResult<{ created_at?: string }>(env, 'vinax_events', 'select=created_at&order=created_at.desc&limit=1'),
    pingSearch(env),
  ]);
  // 7.2.0 — the database half of this panel names its failure instead of
  // guessing between "paused, empty or failing"; the AI pings stay useful.
  const lastEventAt = lastEvents.ok && lastEvents.rows.length ? (lastEvents.rows[0].created_at ?? null) : null;
  const dbReadable = lastEvents.ok;
  const dbError = lastEvents.ok ? null : dbErrorCode(lastEvents.error);
  return new Response(
    JSON.stringify({
      time: new Date().toISOString(),
      ai: [maestro, dj, chat, sage, swift, scholar, home, search, router, vision, webSearch],
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
