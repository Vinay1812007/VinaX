/**
 * System health: live-checks all seven AI lane keys (tiny 4-token ping, each
 * against its OWN lane endpoint — providers are mixed now) and Supabase
 * write freshness, so an outage shows its exact cause instead of guesswork.
 * Admin-gated because each check spends a few model tokens.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
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
  const [dj, muse, sage, swift, scholar, home, search, lastEvents] = await Promise.all([
    pingKey('VinaX 120B · AI DJ · radio · smart queue', env.VINAX_CHATGPT_120_B, LANE_MODEL.dj, laneEndpoint(env, 'dj')),
    pingKey('VinaX FLASH · chat · playlists', env.VINAX_DEEPSEEK_V4_FLASH, LANE_MODEL.chat, laneEndpoint(env, 'chat')),
    pingKey('VinaX SUPER · deep reasoning', env.VINAX_NEMOTRON_SUPER, LANE_MODEL.deep, laneEndpoint(env, 'deep')),
    pingKey('VinaX 20B · fast answers', env.VINAX_CHATGPT_20_B, LANE_MODEL.fast, laneEndpoint(env, 'fast')),
    pingKey('VinaX INSTANT · music knowledge', env.VINAX_GROQ_API_KEY, LANE_MODEL.scholar, laneEndpoint(env, 'scholar')),
    pingKey('VinaX ULTRA · home builder · live voice', env.VINAX_NEMOTRON_ULTRA, LANE_MODEL.home, laneEndpoint(env, 'home')),
    pingKey('VinaX NANO 3 · search music expert', env.VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B, LANE_MODEL.search, laneEndpoint(env, 'search')),
    sbSelect<{ created_at?: string }>(env, 'vinax_events', 'select=created_at&order=created_at.desc&limit=1'),
  ]);
  const lastEventAt = lastEvents.length ? (lastEvents[0].created_at ?? null) : null;
  return new Response(
    JSON.stringify({
      time: new Date().toISOString(),
      ai: [dj, muse, sage, swift, scholar, home, search],
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
