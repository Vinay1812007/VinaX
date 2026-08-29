/**
 * TEMPORARY live model probe (v5.4.0) — verifies which model slugs actually
 * serve on which env keys BEFORE any lane re-pin, the same discipline every
 * re-pin since v2.7.2 has followed (temp /api/lanecheck, since deleted).
 *
 * POST { env: "VINAX_KIMI_K3", model: "moonshotai/kimi-k3", op?: "chat"|"embed" }
 * → { status, ok, latency_ms, contentLen | vector, err? }
 *
 * Exposes NO secrets (status codes, latency and short upstream error text
 * only), accepts only whitelisted env names, and is rate-limited. DELETE
 * this file (and its router entry) once the verification pass is done.
 */
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';

const ALLOWED_ENVS = new Set([
  'VINAX_KIMI_K3',
  'VINAX_DEEPSEEK_V4_PRO',
  'VINAX_DEEPSEEK_V4_FLASH',
  'VINAX_NEMOTRON_3_5_LIGHTNING_30B_A3B',
  'VINAX_MUSE_GLIMMER_30B',
  'VINAX_RIVA_TRANSLATE_4B_INSTRUCT_V2',
  'VINAX_RIVA_TRANSLATE_4B_INSTRUCT_V1_1',
  'VINAX_ISING_CALIBRATION_1_5_31B',
  'VINAX_ISING_CALIBRATION_1_35B_A3B',
  'VINAX_NEMOTRON_3_EMBED_1B',
  'VINAX_LAGUNA_XS_2_1',
  'VINAX_MINIMAX_M3',
  'VINAX_DIFFUSIONGEMMA_26B_A4B_IT',
  'VINAX_NEMOTRON_ULTRA',
  'VINAX_NEMOTRON_3_5_CONTENT_SAFETY',
  'VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B',
  'VINAX_NEMOTRON_3_NANO_30B_A3B',
  'VINAX_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING',
  'VINAX_SYNTHETIC_VIDEO_DETECTOR',
  'VINAX_ACTIVE_SPEAKER_DETECTION',
  'VINAX_GEMMA_4_31B_IT',
  'VINAX_NEMOTRON_VOICECHAT',
  'VINAX_NEMOTRON_SUPER',
  'VINAX_STREAMPETR',
  'VINAX_LLAMA_3_1_NEMOTRON_SAFETY_GUARD_8B_V3',
  'VINAX_CHATGPT_20_B',
  'VINAX_CHATGPT_120_B',
  'VINAX_GROQ_API_KEY',
]);

const NVIDIA_CHAT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_EMBED = 'https://integrate.api.nvidia.com/v1/embeddings';
const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: {
  request: Request;
  env: Record<string, unknown>;
}): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'modelcheck', { capacity: 30, refillPerMinute: 20 });
  if (limited) return limited;

  let body: { env?: unknown; model?: unknown; op?: unknown; base?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const envName = typeof body.env === 'string' ? body.env : '';
  const model = typeof body.model === 'string' ? body.model.slice(0, 96) : '';
  if (!ALLOWED_ENVS.has(envName) || !model) return json({ error: 'bad_request' }, 400);
  const key = env[envName];
  if (typeof key !== 'string' || key.length === 0) {
    return json({ env: envName, model, ok: false, status: 0, err: 'env_missing' });
  }
  const op = body.op === 'embed' ? 'embed' : 'chat';
  const url = op === 'embed' ? NVIDIA_EMBED : body.base === 'groq' ? GROQ_CHAT : NVIDIA_CHAT;

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18_000);
  try {
    const payload =
      op === 'embed'
        ? { model, input: ['vinax probe'] }
        : {
            model,
            max_tokens: 48,
            temperature: 0.2,
            messages: [{ role: 'user' as const, content: 'Reply with the single word: ok' }],
          };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => '');
    let contentLen = 0;
    let vector = 0;
    try {
      const data = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
        data?: Array<{ embedding?: unknown[] }>;
      };
      contentLen = data.choices?.[0]?.message?.content?.length ?? 0;
      vector = Array.isArray(data.data?.[0]?.embedding) ? data.data[0].embedding.length : 0;
    } catch {
      /* upstream sent non-JSON — status + err snippet still tell the story */
    }
    return json({
      env: envName,
      model,
      op,
      status: res.status,
      ok: res.ok && (contentLen > 0 || vector > 0),
      latency_ms: Date.now() - t0,
      contentLen,
      vector,
      err: res.ok ? undefined : text.slice(0, 240),
    });
  } catch {
    return json({ env: envName, model, op, status: 0, ok: false, latency_ms: Date.now() - t0, err: 'timeout_or_network' });
  } finally {
    clearTimeout(timer);
  }
};
