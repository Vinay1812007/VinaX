/** Text-to-image for VinaX AI — NVIDIA-hosted image models on the existing
 *  server keys. Returns a data URL; the client renders it in the chat.
 *  Fully gated: if the key lacks image access, the client gets an honest
 *  error instead of a hang. */
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { type AiEnv } from '../_lib/ai';

type Env = AiEnv;

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });

/** POST-only: answer GET with an honest 405 instead of the SPA shell (DQA-07). */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const limited = rateLimit(context.request, 'image', { capacity: 6, refillPerMinute: 3 });
  if (limited) return limited;
  try {
    return await handleImage(context);
  } catch {
    // Was returning 200 with error body — client `res.ok` never fired and
    // the missing image silently dropped from the AI reply (audit finding
    // M13). 502 makes the failure visible.
    return json({ error: 'engine_unreachable' }, 502);
  }
};

const handleImage = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  // NVIDIA-hosted image endpoint — NVIDIA keys only. VINAX_GROQ_API_KEY is
  // excluded: it's a Groq key (scholar lane) and can't sign this call.
  const key =
    env.VINAX_DEEPSEEK_V4_FLASH ??
    env.VINAX_CHATGPT_120_B ??
    env.VINAX_NEMOTRON_ULTRA ??
    env.VINAX_NEMOTRON_SUPER ??
    env.VINAX_CHATGPT_20_B ??
    env.VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B ??
    null;
  // No image key means the feature is unavailable, not that the client sent
  // a bad request — surface as 503 (audit finding M13).
  if (!key) return json({ error: 'not_configured' }, 503);
  const body = (await request.json().catch(() => null)) as { prompt?: string } | null;
  const prompt = (body?.prompt ?? '').toString().trim().slice(0, 600);
  if (prompt.length < 3) return json({ error: 'bad_request' }, 400);
  const model = 'stabilityai/sdxl-turbo';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25_000);
  try {
    const up = await fetch(`https://ai.api.nvidia.com/v1/genai/${model}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(
        model.includes('sdxl-turbo')
          ? {
              text_prompts: [{ text: prompt }],
              seed: Math.floor(Math.random() * 4_294_967_295),
              sampler: 'K_EULER_ANCESTRAL',
              steps: 4,
            }
          : {
              prompt,
              negative_prompt: '',
              mode: 'text-to-image',
              aspect_ratio: '1:1',
              seed: Math.floor(Math.random() * 4_294_967_295),
              steps: 28,
              cfg_scale: 5,
            },
      ),
      // Clear the timer once the fetch resolves (see finally) so it doesn't
      // hold the isolate awake past the response (audit finding L7).
      signal: controller.signal,
    });
    if (!up.ok) {
      const status = up.status;
      const reason = status === 401 || status === 403 ? 'not_enabled' : status === 404 ? 'model_unavailable' : 'upstream_error';
      // Non-2xx from the upstream is a bad-gateway from the client's POV.
      return json({ error: reason, status }, 502);
    }
    // The payload is a ~2 MB JSON with one huge base64 field. A full
    // JSON.parse can blow the CPU budget at the edge — extract by regex.
    const txt = await up.text();
    const m = /"image"\s*:\s*"([A-Za-z0-9+/=]+)"/.exec(txt) ?? /"base64"\s*:\s*"([A-Za-z0-9+/=]+)"/.exec(txt);
    if (!m) return json({ error: 'empty_image' }, 502);
    return new Response('{"image":"data:image/jpeg;base64,' + m[1] + '"}', {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
    });
  } catch {
    return json({ error: 'engine_unreachable' }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
};
