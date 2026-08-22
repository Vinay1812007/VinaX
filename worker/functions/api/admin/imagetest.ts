/** TEMP diagnostics: run the image upstream call server-side and report
 *  exactly what the edge sees (status, timing, body head). Admin-gated. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { type AiEnv } from '../../_lib/ai';

type Env = AdminEnv & AiEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  // NVIDIA keys only — VINAX_GROQ_API_KEY is a Groq key (scholar lane).
  const key = env.VINAX_DEEPSEEK_V4_FLASH ?? env.VINAX_CHATGPT_120_B ?? env.VINAX_NEMOTRON_ULTRA ?? env.VINAX_NEMOTRON_SUPER ?? env.VINAX_CHATGPT_20_B ?? env.VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B ?? null;
  if (!key) return new Response(JSON.stringify({ step: 'key', ok: false }), { headers: { 'content-type': 'application/json' } });
  const model = 'stabilityai/sdxl-turbo';
  const t0 = Date.now();
  try {
    const c = new AbortController();
    setTimeout(() => c.abort(), 20_000);
    const up = await fetch(`https://ai.api.nvidia.com/v1/genai/${model}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ text_prompts: [{ text: 'a small cyan wave, digital art' }], seed: 1, sampler: 'K_EULER_ANCESTRAL', steps: 4 }),
      signal: c.signal,
    });
    const ms = Date.now() - t0;
    const txt = await up.text().catch(() => '');
    return new Response(
      JSON.stringify({ step: 'fetch', status: up.status, ms, bodyBytes: txt.length, head: txt.slice(0, 180) }),
      { headers: { 'content-type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ step: 'exception', ms: Date.now() - t0, message: e instanceof Error ? e.message : String(e) }),
      { headers: { 'content-type': 'application/json' } },
    );
  }
};
