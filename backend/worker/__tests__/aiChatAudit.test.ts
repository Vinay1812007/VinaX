/**
 * 11.0 — regression tests for the VinaX AI chat audit: the OpenRouter lane on
 * the Auto ladder, image reading beyond the two NVIDIA vision seats, one image
 * for single-image seats, the NVIDIA-only template knob, honest status codes,
 * the default speech path, the per-attempt usage opt-out, the thread size
 * budget, unclosed reasoning, and stopping the upstream when the listener
 * leaves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Ctx = { request: Request; env: Record<string, string> };
type ChatModule = {
  onRequestPost: (c: Ctx) => Promise<Response>;
  trimHistory: <T extends { role: string; content: string }>(h: T[], budget?: number) => T[];
  HISTORY_CHAR_BUDGET: number;
};
interface Call { url: string; body: string; json: Record<string, unknown> }

let ip = 0;
const req = (body: unknown, path = 'vinaxai'): Request =>
  new Request(`https://example.test/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.77.3.${++ip}` },
    body: JSON.stringify(body),
  });
const sse = (text: string): Response =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const geminiSse = (text: string): Response =>
  new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const img = (tag: string): string => `data:image/png;base64,${tag.repeat(120)}`;
const FREE = { prompt: '0', completion: '0' };
const ROUTER_LIST = { data: [{ id: 'acme/listed-now:free', name: 'Acme: Listed Now (free)', context_length: 131072, pricing: FREE, architecture: { input_modalities: ['text'], output_modalities: ['text'] } }] };

/** Stub fetch: GETs are model lists (`lists` by URL fragment, else empty), POSTs are recorded and answered by `answer`. */
function stub(answer: (c: Call, n: number) => Response | Promise<Response>, lists: Record<string, unknown> = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    if (!init?.body) {
      const hit = Object.keys(lists).find((k) => url.includes(k));
      return new Response(JSON.stringify(hit ? lists[hit] : { data: [], models: [] }), { status: 200 });
    }
    const body = String(init.body);
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(body) as Record<string, unknown>; } catch { /* not JSON */ }
    const call = { url, body, json };
    calls.push(call);
    return answer(call, calls.length);
  }));
  return calls;
}
async function load(): Promise<ChatModule> {
  vi.resetModules();
  return (await import('../functions/api/vinaxai')) as unknown as ChatModule;
}
const ask = async (body: Record<string, unknown>, env: Record<string, string>): Promise<{ status: number; text: string; res: Response }> => {
  const m = await load();
  const res = await m.onRequestPost({ request: req({ messages: [{ role: 'user', content: 'hi' }], ...body }), env });
  return { status: res.status, text: await res.text(), res };
};
const imagesIn = (c: Call): number => (c.body.match(/"image_url":\{|"inlineData":\{/g) ?? []).length;

afterEach(() => vi.unstubAllGlobals());

describe('VinaX AI chat audit (11.0)', () => {
  it('Auto answers on an OpenRouter-only setup, with the live catalogue default', async () => {
    const calls = stub(() => sse('hello'), { 'openrouter.ai': ROUTER_LIST });
    const { status, text } = await ask({ mode: 'auto' }, { OPENROUTER_API_KEY: 'k-or' });
    expect(status).toBe(200);
    expect(text).toContain('hello');
    expect(calls[0].url).toContain('openrouter.ai');
    expect(calls[0].json.model).toBe('acme/listed-now:free');
  });

  it('Auto falls back to the OpenRouter lane when every NVIDIA engine fails', async () => {
    const calls = stub((c) => (c.url.includes('openrouter.ai') ? sse('rescued') : new Response('{"error":"down"}', { status: 500 })), { 'openrouter.ai': ROUTER_LIST });
    const { status, text } = await ask({ mode: 'auto' }, { NVIDIA_API_KEY: 'k-n', OPENROUTER_API_KEY: 'k-or' });
    expect(status).toBe(200);
    expect(text).toContain('rescued');
    expect(calls.some((c) => c.url.includes('openrouter.ai'))).toBe(true);
  });

  it('an image is read by Gemini when it is the only key', async () => {
    const calls = stub(() => geminiSse('a cat'));
    const { status } = await ask({ mode: 'auto', images: [img('A')] }, { GEMINI_API_KEY: 'AIzaTESTKEY' });
    expect(status).toBe(200);
    expect(calls[0].url).toContain('generativelanguage.googleapis.com');
    expect(imagesIn(calls[0])).toBe(1);
    expect(calls[0].body).not.toContain('image understanding is offline');
  });

  it('a single-image vision seat is sent only the most recent image', async () => {
    const calls = stub(() => sse('ok'));
    await ask({ mode: 'auto', images: [img('A'), img('B'), img('C')] }, { NVIDIA_API_KEY: 'k-n' });
    expect(calls[0].json.model).toBe('meta/llama-3.2-11b-vision-instruct');
    expect(imagesIn(calls[0])).toBe(1);
    expect(calls[0].body).toContain(img('C'));
  });

  it('a turn with several images goes to a multi-image engine first when one is configured', async () => {
    const calls = stub((c) => (c.url.includes('generativelanguage') ? geminiSse('three photos') : sse('ok')));
    await ask({ mode: 'auto', images: [img('A'), img('B'), img('C')] }, { NVIDIA_API_KEY: 'k-n', GEMINI_API_KEY: 'AIzaTESTKEY' });
    expect(calls[0].url).toContain('generativelanguage.googleapis.com');
    expect(imagesIn(calls[0])).toBe(3);
  });

  it('chat_template_kwargs travels to the NVIDIA endpoint only', async () => {
    const groqList = { data: [{ id: 'qwen/qwen3-32b', object: 'model', active: true, owned_by: 'Alibaba Cloud', context_window: 131072 }] };
    let calls = stub(() => sse('ok'), { 'api.groq.com': groqList });
    await ask({ mode: 'model', provider: 'groq', model: 'qwen/qwen3-32b' }, { GROQ_API_KEY: 'k-g' });
    expect(calls[0].url).toContain('groq');
    expect(calls[0].json.model).toBe('qwen/qwen3-32b');
    expect(calls[0].json).not.toHaveProperty('chat_template_kwargs');
    vi.unstubAllGlobals();
    calls = stub(() => sse('{"songs":[]}'));
    await ask({ mode: 'expert' }, { NVIDIA_API_KEY: 'k-n' });
    expect(String(calls[0].json.model)).toContain('nemotron-3-nano');
    expect(calls[0].json).toHaveProperty('chat_template_kwargs');
  });

  it('every engine rate-limited answers 429 with Retry-After; other upstream failures keep the 500', async () => {
    stub(() => new Response('{"error":"rate"}', { status: 429 }));
    let out = await ask({ mode: 'auto' }, { NVIDIA_API_KEY: 'k-n' });
    expect(out.status).toBe(429);
    expect(Number(out.res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(JSON.parse(out.text)).toEqual({ error: 'upstream', status: 429 });
    vi.unstubAllGlobals();
    stub(() => new Response('{"error":"boom"}', { status: 500 }));
    out = await ask({ mode: 'auto' }, { NVIDIA_API_KEY: 'k-n' });
    // 500, not 502: an origin 502 body is swallowed on the way to the app.
    expect(out.status).toBe(500);
    expect(JSON.parse(out.text)).toEqual({ error: 'upstream', status: 500 });
  });

  it('the default speech request uses another provider when there is no Groq key', async () => {
    const list = { data: [{ id: 'fish-audio/s2.1-pro-free:free', name: 'Fish Audio: S2.1 Pro Free (free)', pricing: FREE, supported_voices: null, architecture: { input_modalities: ['text'], output_modalities: ['speech'] } }] };
    const calls = stub(() => new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'content-type': 'audio/wav' } }), { 'openrouter.ai': list });
    vi.resetModules();
    const tts = (await import('../functions/api/tts')) as unknown as { onRequestPost: (c: Ctx) => Promise<Response> };
    const res = await tts.onRequestPost({ request: req({ text: 'Good evening.', voice: 'troy' }, 'tts'), env: { OPENROUTER_API_KEY: 'k-or' } });
    expect(res.status).not.toBe(503);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toContain('openrouter.ai');
    expect(calls[0].body).toContain('fish-audio/s2.1-pro-free:free');
  });

  it('a 400 drops the usage option for that attempt only, and Gemini is not asked the same thing twice', async () => {
    const calls = stub((_c, n) => (n <= 2 ? new Response('{"error":"bad"}', { status: 400 }) : sse('fine')));
    const { text } = await ask({ mode: 'auto' }, { NVIDIA_API_KEY: 'k-n' });
    expect(text).toContain('fine');
    expect(calls[0].json.stream_options).toEqual({ include_usage: true });
    expect(calls[1].json.model).toBe(calls[0].json.model);
    expect(calls[1].json).not.toHaveProperty('stream_options');
    // The next engine keeps its usage chunk.
    expect(calls[2].json.model).not.toBe(calls[0].json.model);
    expect(calls[2].json.stream_options).toEqual({ include_usage: true });
    vi.unstubAllGlobals();
    const gem = stub(() => new Response('{"error":{"message":"bad request"}}', { status: 400 }));
    await ask({ mode: 'auto' }, { GEMINI_API_KEY: 'AIzaTESTKEY' });
    expect(gem.length).toBe(1);
  });

  it('a long thread is trimmed to the size budget and keeps the latest user turn whole', async () => {
    const m = await load();
    const turn = (role: string, ch: string) => ({ role, content: ch.repeat(24_000) });
    const kept = m.trimHistory([turn('user', 'a'), turn('assistant', 'b'), turn('user', 'c'), turn('assistant', 'd'), turn('user', 'e')], 60_000);
    expect(kept.map((t) => t.content[0])).toEqual(['e']);
    expect(m.trimHistory([turn('user', 'z')], 10)).toHaveLength(1);
    const calls = stub(() => sse('ok'));
    const messages = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: String.fromCharCode(97 + (i % 26)).repeat(24_000) }));
    await ask({ mode: 'auto', messages }, { NVIDIA_API_KEY: 'k-n' });
    const sent = calls[0].json.messages as { role: string; content: string }[];
    const thread = sent.filter((x) => x.role !== 'system');
    expect(thread.reduce((n, x) => n + x.content.length, 0)).toBeLessThanOrEqual(m.HISTORY_CHAR_BUDGET + 200 * thread.length);
    expect(thread[0].role).toBe('user');
    expect(thread[thread.length - 1].content).toContain(messages[39].content);
  });

  it('reasoning that never closes is never shown as the answer, and the reply is marked cut short', async () => {
    stub(() => sse('<think>working through the question step by step'));
    const { status, text } = await ask({ mode: 'auto' }, { NVIDIA_API_KEY: 'k-n' });
    expect(status).toBe(200);
    expect(text).not.toContain('working through the question step by step');
    expect(text).not.toContain('<think>');
    expect(text).toContain('"truncated":true');
  });

  it('stops reading the upstream when the listener disconnects', async () => {
    const cancelled = vi.fn();
    const enc = new TextEncoder();
    stub(() => new Response(new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'first words' } }] })}\n\n`)); },
      cancel: cancelled,
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const m = await load();
    const res = await m.onRequestPost({ request: req({ mode: 'auto', messages: [{ role: 'user', content: 'hi' }] }), env: { NVIDIA_API_KEY: 'k-n' } });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(cancelled).toHaveBeenCalled();
  });
});
