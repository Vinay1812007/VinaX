/** Probe any chat model slug on a lane's endpoint (per-lane provider base —
 *  scholar rides Groq, the rest NVIDIA) — status + latency.
 *  Admin-gated. Used to validate lanes before wiring them.
 *  ?key=CHATGPT_120_B|CHATGPT_20_B|DEEPSEEK_V4_FLASH|NEMOTRON_SUPER|
 *  NEMOTRON_ULTRA|GROQ_API_KEY|NVIDIA_NEMOTRON_3_NANO_30B_A3B (gen-4 names)
 *  picks which lane env key signs the call (default DEEPSEEK_V4_FLASH);
 *  ?model= overrides the probed slug (default: that lane's pinned model). */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { rateLimit } from '../../_lib/ratelimit';
import { LANE_MODEL, laneEndpoint, type AiEnv, type Lane } from '../../_lib/ai';

type Env = AdminEnv & AiEnv;

const BY_SUFFIX: Record<string, { env: keyof AiEnv; lane: Lane }> = {
  CHATGPT_120_B: { env: 'VINAX_CHATGPT_120_B', lane: 'dj' },
  DEEPSEEK_V4_FLASH: { env: 'VINAX_DEEPSEEK_V4_FLASH', lane: 'chat' },
  NEMOTRON_SUPER: { env: 'VINAX_NEMOTRON_SUPER', lane: 'deep' },
  CHATGPT_20_B: { env: 'VINAX_CHATGPT_20_B', lane: 'fast' },
  GROQ_API_KEY: { env: 'VINAX_GROQ_API_KEY', lane: 'scholar' },
  NEMOTRON_ULTRA: { env: 'VINAX_NEMOTRON_ULTRA', lane: 'home' },
  NVIDIA_NEMOTRON_3_NANO_30B_A3B: { env: 'VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B', lane: 'search' },
};

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  // Paid upstream ping — throttle even for authed callers (audit: unthrottled).
  const limited = await rateLimit(request, 'admin-enginetest', { capacity: 10, refillPerMinute: 10 }, env as never);
  if (limited) return limited;
  const url = new URL(request.url);
  const suffix = (url.searchParams.get('key') ?? 'DEEPSEEK_V4_FLASH').toUpperCase();
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
