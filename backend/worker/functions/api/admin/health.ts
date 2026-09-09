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
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { rateLimit } from '../../_lib/ratelimit';
import { sbSelect, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';
import { LANE_MODEL, laneEndpoint, type AiEnv } from '../../_lib/ai';

type Env = AdminEnv & SupabaseEnv & AiEnv;

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
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: 4, messages: [{ role: 'user', content: 'ping' }] }),
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
  if (!isAdmin(request, env)) return unauthorized();
  // 9 live model pings per call — cap the frequency so a stuck 10s auto-
  // refresh loop can't burn upstream quota (audit: unthrottled).
  const limited = rateLimit(request, 'admin-health', { capacity: 4, refillPerMinute: 2 }, env as never);
  if (limited) return limited;
  const [dj, chat, sage, swift, scholar, home, search, router, vision, lastEvents] = await Promise.all([
    pingKey('VinaX LTNG · AI DJ · radio · smart queue', env.VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B, LANE_MODEL.dj, laneEndpoint(env, 'dj')),
    pingKey('VinaX Balanced · chat · playlists', env.VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B, LANE_MODEL.chat, laneEndpoint(env, 'chat')),
    pingKey('VinaX NMTRN SUP · deep reasoning', env.VINAX_NVD_NEMOTRON_3_SUPER_120B_A12B, LANE_MODEL.deep, laneEndpoint(env, 'deep')),
    pingKey('VinaX OSS 20B · fast answers', env.VINAX_OAI_GPT_OSS_20B, LANE_MODEL.fast, laneEndpoint(env, 'fast')),
    pingKey('VinaX GRQ ALL · music knowledge · live voice', env.VINAX_GROQ_API_KEY, LANE_MODEL.scholar, laneEndpoint(env, 'scholar')),
    pingKey('VinaX NMTRN ULT · home builder', env.VINAX_NVD_NEMOTRON_3_ULTRA_550B_A55B, LANE_MODEL.home, laneEndpoint(env, 'home')),
    pingKey('VinaX NMTRN NN OMNI · search music expert', env.VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING, LANE_MODEL.search, laneEndpoint(env, 'search')),
    pingKey('VinaX OPR ALL · free model marketplace', env.VINAX_OPENROUTER_API_KEY, LANE_MODEL.router, laneEndpoint(env, 'router')),
    pingKey('VinaX VSN 11B · image understanding', env.VINAX_MTA_LMA_3_2_11B_VSN_INT, LANE_MODEL.vision, laneEndpoint(env, 'vision')),
    sbSelect<{ created_at?: string }>(env, 'vinax_events', 'select=created_at&order=created_at.desc&limit=1'),
  ]);
  const lastEventAt = lastEvents.length ? (lastEvents[0].created_at ?? null) : null;
  return new Response(
    JSON.stringify({
      time: new Date().toISOString(),
      ai: [dj, chat, sage, swift, scholar, home, search, router, vision],
      supabase: {
        configured: supabaseConfigured(env),
        lastEventAt,
        note: lastEventAt
          ? null
          : 'No readable events — Supabase paused/unreachable, table empty, or writes failing.',
      },
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
