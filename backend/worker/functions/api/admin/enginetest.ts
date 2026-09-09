/** Probe any chat model slug on a lane's endpoint (per-lane provider base —
 *  the scholar and router lanes ride their own hosts, the rest the default
 *  base) — status + latency. Admin-gated. Used to validate lanes before
 *  wiring them, and to re-verify every row after a key rotation.
 *  ?key= names which lane key signs the call — see BY_SUFFIX below for the
 *  accepted values (default LIGHTNING, the balanced/DJ key);
 *  ?model= overrides the probed slug (default: that lane's pinned model). */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { rateLimit } from '../../_lib/ratelimit';
import { LANE_MODEL, laneEndpoint, type AiEnv, type Lane } from '../../_lib/ai';

type Env = AdminEnv & AiEnv;

// One row per live secret (the owner's 2026-09-09 key set), keyed by a short
// suffix so a probe URL stays typable.
const BY_SUFFIX: Record<string, { env: keyof AiEnv; lane: Lane }> = {
  LIGHTNING: { env: 'VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B', lane: 'dj' },
  GPT_OSS_20B: { env: 'VINAX_OAI_GPT_OSS_20B', lane: 'fast' },
  NEMOTRON_SUPER: { env: 'VINAX_NVD_NEMOTRON_3_SUPER_120B_A12B', lane: 'deep' },
  NEMOTRON_ULTRA: { env: 'VINAX_NVD_NEMOTRON_3_ULTRA_550B_A55B', lane: 'home' },
  NEMOTRON_OMNI: { env: 'VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING', lane: 'search' },
  DEEPSEEK_V4_PRO: { env: 'VINAX_DEEPSEEK_V4_PRO_0813', lane: 'pro' },
  DEEPSEEK_V4_FLASH: { env: 'VINAX_DEEPSEEK_V4_FLASH_0731', lane: 'dsflash' },
  MISTRAL_NEMOTRON: { env: 'VINAX_MISTRAL_NEMOTRON', lane: 'mini' },
  KIMI_K3: { env: 'VINAX_KIMI_K3', lane: 'agent' },
  GROQ_API_KEY: { env: 'VINAX_GROQ_API_KEY', lane: 'scholar' },
  OPENROUTER_API_KEY: { env: 'VINAX_OPENROUTER_API_KEY', lane: 'router' },
  VISION_11B: { env: 'VINAX_MTA_LMA_3_2_11B_VSN_INT', lane: 'vision' },
  VISION_90B: { env: 'VINAX_MTA_LMA_3_2_90B_VSN_INT', lane: 'vision90' },
  MUSE_GLIMMER: { env: 'VINAX_MTA_MUSE_GLIMMER_30B', lane: 'muse' },
  ISING_CALIBRATION: { env: 'VINAX_NVD_ISING_CALIBRATION_1_5_31B', lane: 'rank' },
  LAGUNA_XS: { env: 'VINAX_POOLSIDE_LAGUNA_XS_2_1', lane: 'laguna' },
  DIFFUSIONGEMMA: { env: 'VINAX_GGL_DIFFUSIONGEMMA_26B_A4B_IT', lane: 'diffusion' },
  GEMMA_4: { env: 'VINAX_GGL_GEMMA_4_31B_IT', lane: 'gemma4' },
};

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  // Paid upstream ping — throttle even for authed callers (audit: unthrottled).
  const limited = rateLimit(request, 'admin-enginetest', { capacity: 10, refillPerMinute: 10 }, env as never);
  if (limited) return limited;
  const url = new URL(request.url);
  const suffix = (url.searchParams.get('key') ?? 'LIGHTNING').toUpperCase();
  const pick = BY_SUFFIX[suffix];
  if (!pick) return json({ error: 'unknown key', keys: Object.keys(BY_SUFFIX) }, 400);
  const key = env[pick.env];
  if (!key) return json({ key: suffix, error: 'env not set', env: pick.env }, 503);
  const model = url.searchParams.get('model') ?? LANE_MODEL[pick.lane];
  const base = laneEndpoint(env, pick.lane);
  const t0 = Date.now();
  const c = new AbortController();
  // Capture the timer id and clear it in finally so it doesn't tick after
  // the fetch resolves (audit finding L7).
  const timerId = setTimeout(() => c.abort(), 15_000);
  try {
    const up = await fetch(base, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 8, temperature: 0 }),
      signal: c.signal,
    });
    const ms = Date.now() - t0;
    const txt = await up.text().catch(() => '');
    return json({ key: suffix, model, status: up.status, ms, head: txt.slice(0, 220) });
  } catch (e) {
    return json({ key: suffix, model, status: 0, ms: Date.now() - t0, exception: e instanceof Error ? e.message : String(e) });
  } finally {
    clearTimeout(timerId);
  }
};
