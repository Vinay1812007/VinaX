import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANE_BY_MODE, NO_LIVE_WEB, attemptModel, identityLine, onRequestPost, requestMode } from './vinaxai';
import { LANE_BASE, LANE_MODEL, clearLaneCooldowns } from '../_lib/ai';
import { resetCatalogCache } from '../_lib/catalog';
import { resetMaestroMode, resetMaestroModels } from '../_lib/maestro';

/** Locks the v3.4.1 voice-latency fix: live-voice replies are spoken back, so
 *  first-token latency is everything. Voice was re-laned off the 550B home
 *  engine (~6.7 s to first token, measured live — a long silence after every
 *  spoken turn) onto the sub-second scholar lane (~0.5 s, measured live). Home
 *  must NEVER be voice's primary again without an owner-signed latency win. */
describe('voice reply lane (v3.4.1 latency fix)', () => {
  it('routes live-voice replies to the fast scholar lane, not the slow 550B home lane', () => {
    expect(LANE_BY_MODE.voice).toBe('scholar');
    expect(LANE_BY_MODE.voice).not.toBe('home');
  });

  // v5.23.0 — this used to assert an exact slug, which broke the moment the
  // provider retired it (and the lane 404'd in production before the test
  // ever noticed). The property that actually matters is the one asserted
  // here: voice rides a lane on a FAST EXTERNAL base, and never the 550B.
  it('the voice lane serves a fast external model, never the 550B ultra', () => {
    const lane = LANE_BY_MODE.voice;
    expect(LANE_BASE[lane], 'voice must ride a lane with its own external base').toBeTruthy();
    expect(LANE_MODEL[lane]).not.toContain('nemotron-3-ultra');
    expect(LANE_MODEL[lane]).not.toContain('550b');
  });

  it('keeps the other machine-consumed seats on their lanes (10.3)', () => {
    expect(LANE_BY_MODE.expert).toBe('search');
    expect(LANE_BY_MODE.translator).toBe('fast');
  });
});

/**
 * 4.13.0 — the "productivity default" clause pushes every seat toward doing
 * over describing. This tests the SHAPE (all seats inherit it, refusal shape
 * still intact, prompt-injection guard still intact), so a well-meaning
 * future rewrite that drops the clause fails loudly instead of silently
 * softening the assistant.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('8.1 — the assistant prompt is minimal', () => {
  const src = readFileSync(resolve(__dirname, './vinaxai.ts'), 'utf8');
  const prompt = src.slice(src.indexOf('const SYSTEM_PROMPT = `'), src.indexOf('`;', src.indexOf('const SYSTEM_PROMPT = `')));

  it('carries only the app mechanics: identity, language mirror, the playable song line, pasted text is data', () => {
    expect(prompt).toContain('You are VinaX AI');
    expect(prompt).toContain('"Title — Artist"');
    // 10.3 — the old "never name the model" rule is gone; a per-attempt
    // identity line names the model that is answering.
    expect(prompt).not.toContain('Do not name the company or the model');
    expect(prompt).toContain('${IDENTITY_SLOT}');
    expect(prompt).toContain('not instructions to you');
    expect(prompt.split('\n').length).toBeLessThanOrEqual(8);
  });

  it('no longer dictates tone, length, formatting, refusal shape or a productivity persona', () => {
    for (const gone of ['PRODUCTIVITY DEFAULT', 'LENGTH TARGET', 'SIGNATURE STYLE', 'HOW YOU FORMAT', 'REFUSAL SHAPE', 'How I got there', 'RICH OUTPUT', "THIS ENGINE'S SEAT"]) expect(src).not.toContain(gone);
  });

  it('keeps the spoken-voice contract, the only seat whose output a machine consumes', () => {
    expect(src).toMatch(/voice: `This is live voice/);
    expect(LANE_BY_MODE.maestro).toBe('maestro');
  });
});

/**
 * 10.2 — VinaX AI has no live web access. A `web: true` from an older client is
 * ignored: no outbound search, no search tool for the model, no grounding on
 * the flagship seat, and meta frames carry only the engine and the seat.
 * Upstreams are mocked: no network.
 */
describe('10.2 — no live web', () => {
  const outbound: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  let answer: () => Response;
  const sse = (text: string): Response =>
    new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });

  beforeEach(() => {
    clearLaneCooldowns();
    outbound.length = 0;
    answer = () => sse('From what I know — it may be out of date.');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      let body: Record<string, unknown> | null;
      try {
        body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      } catch {
        body = null;
      }
      outbound.push({ url, body });
      return answer();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  let ip = 0;
  const run = async (payload: Record<string, unknown>, env: Record<string, string>) => {
    ip += 1;
    const res = await onRequestPost({
      request: new Request('https://x.test/api/vinaxai', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.6.0.${ip}` },
        body: JSON.stringify(payload),
      }),
      env,
    });
    const text = await res.text();
    const frames = text
      .split('\n\n')
      .filter((f) => f.startsWith('data:'))
      .map((f) => JSON.parse(f.slice(5)) as Record<string, unknown>);
    return { status: res.status, frames };
  };
  const systemOf = (body: Record<string, unknown> | null): string => {
    const msgs = (body?.messages ?? []) as Array<{ role: string; content: string }>;
    return msgs.find((m) => m.role === 'system')?.content ?? '';
  };

  it('a web: true request makes no outbound search and sends no sources in meta', async () => {
    const { status, frames } = await run(
      { web: true, mode: 'muse', messages: [{ role: 'user', content: 'who won the match today?' }] },
      { VINAX_NVIDIA_API_KEY: 'k' },
    );
    expect(status).toBe(200);
    expect(outbound).toHaveLength(1);
    expect(outbound[0].url).toContain('/chat/completions');
    const metas = frames.filter((f) => 'meta' in f).map((f) => f.meta as Record<string, unknown>);
    expect(metas.length).toBeGreaterThan(0);
    for (const m of metas) expect(Object.keys(m).sort()).toEqual(['mode', 'model', 'modelId', 'provider']);
    expect(frames.some((f) => 'step' in f)).toBe(false);
    expect(frames.map((f) => f.delta ?? '').join('')).toBe('From what I know — it may be out of date.');
  });

  it('the system prompt carries the no-live-web line and no search tool or web results', async () => {
    await run({ web: true, mode: 'muse', messages: [{ role: 'user', content: 'latest news today' }] }, { VINAX_NVIDIA_API_KEY: 'k' });
    const sys = systemOf(outbound[0].body);
    expect(sys).toContain(NO_LIVE_WEB);
    for (const gone of ['FETCH', 'LIVE WEB RESULTS', 'LIVE WEB SEARCH FAILED', 'LIVE SEARCH TOOL']) expect(sys).not.toContain(gone);
    expect(NO_LIVE_WEB).toMatch(/no live web access/);
    expect(NO_LIVE_WEB).toMatch(/may be out of date/);
    expect(NO_LIVE_WEB).toMatch(/Never claim to have searched/);
  });

  // 11.0 — grounding exists now, but only on the Gemini 2.5 Flash family and
  // (on Auto) only for a question about now — see aiWebSearch.test.ts. The
  // flagship pin is a 3.x model, so a plain question is never grounded, and
  // pages a model volunteers unasked are never passed on.
  it('the flagship seat is not grounded for a plain question, and unasked outside pages never reach the client', async () => {
    answer = () =>
      new Response(
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Plain answer.' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://news.example/x', title: 'X' } }] } }] })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const { status, frames } = await run({ web: true, mode: 'maestro', messages: [{ role: 'user', content: 'tell me about the raga Kalyani' }] }, { VINAX_GGL_GEMINI_API_KEY: 'AQ.k' });
    expect(status).toBe(200);
    expect(outbound).toHaveLength(1);
    expect(outbound[0].body?.tools).toBeUndefined();
    expect(JSON.stringify(outbound[0].body)).not.toMatch(/google_?search/i);
    expect(JSON.stringify(frames)).not.toContain('news.example');
    for (const f of frames.filter((x) => 'meta' in x)) expect(Object.keys(f.meta as object).sort()).toEqual(['mode', 'model', 'modelId', 'provider']);
  });

  it('the Search-page expert asks the engine only — no web lookup first', async () => {
    answer = () => sse('Butta Bomma — Armaan Malik');
    await run({ mode: 'expert', messages: [{ role: 'user', content: 'Search query: "latest mass songs"\nPreferred languages: telugu' }] }, { VINAX_NVIDIA_API_KEY: 'k' });
    expect(outbound).toHaveLength(1);
    expect(outbound[0].url).toContain('/chat/completions');
    expect(systemOf(outbound[0].body)).not.toMatch(/WEB CONTEXT|WEB RESULTS/);
  });

  it('a tool-run report from an upstream is never forwarded as a step frame', async () => {
    answer = () =>
      new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { executed_tools: [{ index: 0, type: 'search', arguments: '{"query":"x"}' }] } }] })}\n\n` +
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'Plain.' } }] })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const { frames } = await run({ mode: 'muse', messages: [{ role: 'user', content: 'hi' }] }, { VINAX_NVIDIA_API_KEY: 'k' });
    expect(frames.map((f) => Object.keys(f)[0])).toEqual(['meta', 'delta', 'done']);
  });
});

/**
 * 10.3 — the listener picks a MODEL: `{ mode: 'model', provider, model }`
 * against the provider's live free list, or Auto. Every retired engine id is
 * Auto; the three machine-consumed seats keep working. The meta frame and
 * the system prompt name the model that actually answers.
 */
describe('10.3 — model picks, Auto and real model names', () => {
  const outbound: Array<{ url: string; body: Record<string, unknown> | null; headers: Record<string, string> }> = [];
  let answer: (url: string, body: Record<string, unknown> | null) => Response;
  const sse = (text: string): Response =>
    new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const lists: Record<string, unknown> = {
    'integrate.api.nvidia.com/v1/models': { data: [{ id: 'meta/llama-3.2-11b-vision-instruct' }, { id: 'moonshotai/kimi-k3' }, { id: 'nvidia/nemotron-3.5-lightning-30b-a3b' }] },
    'openrouter.ai/api/v1/models': { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B Instruct (free)', pricing: { prompt: '0', completion: '0' } }, { id: 'vendor/paid', name: 'Vendor: Paid', pricing: { prompt: '1', completion: '1' } }] },
    'api.groq.com/openai/v1/models': { data: [{ id: 'llama-3.1-8b-instant', owned_by: 'Meta' }, { id: 'openai/gpt-oss-20b', owned_by: 'OpenAI' }] },
    'generativelanguage.googleapis.com/v1beta/models?': { models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] }] },
  };
  const ENV = { VINAX_NVIDIA_API_KEY: 'nv', VINAX_OPENROUTER_API_KEY: 'or', VINAX_GROQ_API_KEY: 'gq' };

  beforeEach(() => {
    clearLaneCooldowns();
    resetCatalogCache();
    resetMaestroModels();
    resetMaestroMode();
    outbound.length = 0;
    answer = () => sse('answer');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      for (const [needle, list] of Object.entries(lists)) if (url.includes(needle)) return new Response(JSON.stringify(list), { status: 200 });
      let body: Record<string, unknown> | null;
      try {
        body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      } catch {
        body = null;
      }
      outbound.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
      return answer(url, body);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  let ip = 0;
  const run = async (payload: Record<string, unknown>, env: Record<string, string> = ENV) => {
    ip += 1;
    const res = await onRequestPost({
      request: new Request('https://x.test/api/vinaxai', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.7.${Math.floor(ip / 250)}.${ip % 250}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello there' }], ...payload }),
      }),
      env,
    });
    const text = await res.text();
    const frames = text.startsWith('{')
      ? [JSON.parse(text) as Record<string, unknown>]
      : text.split('\n\n').filter((f) => f.startsWith('data:')).map((f) => JSON.parse(f.slice(5)) as Record<string, unknown>);
    return { status: res.status, frames, metas: frames.filter((f) => 'meta' in f).map((f) => f.meta as Record<string, unknown>) };
  };
  const systemOf = (body: Record<string, unknown> | null): string => ((body?.messages ?? []) as Array<{ role: string; content: string }>).find((m) => m.role === 'system')?.content ?? '';

  it('requestMode: model and the three internal seats pass; every retired engine id is Auto', () => {
    expect(requestMode('model')).toBe('model');
    for (const seat of ['voice', 'expert', 'translator']) expect(requestMode(seat)).toBe(seat);
    for (const legacy of ['maestro', 'muse', 'swift', 'sage', 'scholar', 'win', 'nova', 'nano', 'pro', 'flash', 'mini', 'k3', 'glimmer', 'musegl', 'gemma4', 'laguna', 'ising15', 'router', 'fast', 'deep', 'auto', '', undefined, 42])
      expect(requestMode(legacy), String(legacy)).toBe('auto');
  });

  it('a listed model is used first, on its provider\'s key, and meta names it', async () => {
    const { status, metas } = await run({ mode: 'model', provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' });
    expect(status).toBe(200);
    expect(outbound[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(outbound[0].body?.model).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(outbound[0].headers.authorization).toBe('Bearer or');
    expect(metas[0]).toEqual({ model: 'Llama 3.3 70B Instruct', modelId: 'meta-llama/llama-3.3-70b-instruct:free', provider: 'openrouter', mode: 'model' });
  });

  it('pre-10.3 provider ids are understood', async () => {
    const { status } = await run({ mode: 'model', provider: 'grq', model: 'llama-3.1-8b-instant' });
    expect(status).toBe(200);
    expect(outbound[0].url).toContain('api.groq.com');
    expect(outbound[0].body?.model).toBe('llama-3.1-8b-instant');
  });

  it('an unlisted, paid, wrong-provider or unknown-provider model is refused with 400 unknown_model — no engine is called', async () => {
    for (const pick of [
      { provider: 'openrouter', model: 'vendor/paid' },
      { provider: 'openrouter', model: 'vendor/made-up' },
      { provider: 'groq', model: 'moonshotai/kimi-k3' },
      { provider: 'elsewhere', model: 'llama-3.1-8b-instant' },
      { provider: 'nvidia' },
    ]) {
      const { status, frames } = await run({ mode: 'model', ...pick });
      expect(status, JSON.stringify(pick)).toBe(400);
      expect(frames[0]).toEqual({ error: 'unknown_model' });
    }
    // A provider whose key is not set lists nothing, so its models are unknown too.
    expect((await run({ mode: 'model', provider: 'gemini', model: 'gemini-2.5-pro' })).status).toBe(400);
    expect(outbound).toHaveLength(0);
  });

  it('a failed pick hands over to the default ladder inside the budget, and meta names the model that answered', async () => {
    answer = (url) => (url.includes('openrouter.ai') ? new Response('{"error":"down"}', { status: 503 }) : sse('ladder answer'));
    const { status, frames, metas } = await run({ mode: 'model', provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' });
    expect(status).toBe(200);
    expect(frames.map((f) => f.delta ?? '').join('')).toBe('ladder answer');
    expect(outbound[0].url).toContain('openrouter.ai');
    expect(outbound[1].url).toContain('integrate.api.nvidia.com');
    expect(metas[0]).toEqual({ model: 'Nemotron 3.5 Lightning 30B A3B', modelId: 'nvidia/nemotron-3.5-lightning-30b-a3b', provider: 'nvidia', mode: 'model' });
  });

  it('the system prompt names the model each attempt is sent to — also after a hop', async () => {
    answer = (url) => (url.includes('openrouter.ai') ? new Response('down', { status: 500 }) : sse('ok'));
    await run({ mode: 'model', provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' });
    expect(systemOf(outbound[0].body)).toContain('You are VinaX AI, running on Llama 3.3 70B Instruct by Meta, served through OpenRouter. If asked which model you are, say so truthfully.');
    expect(systemOf(outbound[1].body)).toContain('running on Nemotron 3.5 Lightning 30B A3B by NVIDIA, served through NVIDIA');
    for (const o of outbound) expect(systemOf(o.body)).not.toContain('{{MODEL_IDENTITY}}');
  });

  it('identityLine and attemptModel read the attempt\'s provider and model', () => {
    const a = { key: 'k', model: 'openai/gpt-oss-20b', role: 'scholar' as const, endpoint: 'https://api.groq.com/openai/v1/chat/completions' };
    expect(attemptModel(a)).toEqual({ provider: 'groq', id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', maker: 'OpenAI' });
    expect(identityLine(a)).toBe('You are VinaX AI, running on GPT-OSS 20B by OpenAI, served through Groq. If asked which model you are, say so truthfully.');
  });

  it('a retired engine id is Auto (meta mode auto); the three internal seats keep their mode and lane', async () => {
    const legacy = await run({ mode: 'swift' });
    expect(legacy.metas[0]).toMatchObject({ mode: 'auto', provider: 'nvidia' });
    outbound.length = 0;
    // Think on Auto sends `sage`: still Auto to the client, on the deep seat.
    const think = await run({ mode: 'sage' });
    expect(think.metas[0]).toMatchObject({ mode: 'auto', modelId: 'nvidia/nemotron-3-super-120b-a12b' });
    outbound.length = 0;
    const expert = await run({ mode: 'expert' });
    expect(expert.metas[0]).toMatchObject({ mode: 'expert', modelId: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning' });
    expect(systemOf(outbound[0].body)).toContain('OUTPUT CONTRACT');
    outbound.length = 0;
    const voice = await run({ mode: 'voice' });
    expect(voice.metas[0]).toMatchObject({ mode: 'voice', provider: 'groq' });
    expect(outbound[0].url).toContain('api.groq.com');
    outbound.length = 0;
    const tr = await run({ mode: 'translator' });
    expect(tr.metas[0]).toMatchObject({ mode: 'translator', provider: 'nvidia' });
    expect(systemOf(outbound[0].body)).toContain('VinaX TRANSLATE');
  });

  it('an image goes to a picked vision model first, with the image attached', async () => {
    const image = `data:image/png;base64,${'A'.repeat(200)}`;
    const { metas } = await run({ mode: 'model', provider: 'nvidia', model: 'moonshotai/kimi-k3', images: [image] });
    // kimi-k3 does not read images: the vision ladder answers.
    expect(outbound[0].body?.model).toBe('meta/llama-3.2-11b-vision-instruct');
    expect(metas[0]).toMatchObject({ modelId: 'meta/llama-3.2-11b-vision-instruct' });
    outbound.length = 0;
    answer = () => sse('I see a guitar');
    await run({ mode: 'model', provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free', images: [image] });
    expect(outbound[0].body?.model).toBe('meta/llama-3.2-11b-vision-instruct');
    outbound.length = 0;
    // A vision-capable pick goes first.
    lists['openrouter.ai/api/v1/models'] = { data: [{ id: 'google/gemma-4-31b-it:free', name: 'Google: Gemma 4 31B (free)', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['image', 'text'], output_modalities: ['text'] } }] };
    resetCatalogCache();
    const picked = await run({ mode: 'model', provider: 'openrouter', model: 'google/gemma-4-31b-it:free', images: [image] });
    expect(outbound[0].body?.model).toBe('google/gemma-4-31b-it:free');
    const last = (outbound[0].body?.messages as Array<{ content: unknown }>).at(-1)?.content;
    expect(Array.isArray(last) && (last as Array<{ type: string }>).some((p) => p.type === 'image_url')).toBe(true);
    expect(picked.metas[0]).toMatchObject({ model: 'Gemma 4 31B', provider: 'openrouter' });
  });

  it('a Gemini pick is never swapped for another model when it is gone — the ladder answers instead', async () => {
    answer = (url) =>
      url.includes('generativelanguage')
        ? new Response('{"error":{"code":404,"message":"models/gemini-2.5-pro is not found for API version v1beta. Please update your code to use models/gemini-3.8-flash"}}', { status: 404 })
        : sse('ladder');
    const { metas } = await run({ mode: 'model', provider: 'gemini', model: 'gemini-2.5-pro' }, { ...ENV, VINAX_GGL_GEMINI_API_KEY: 'AIza-k' });
    const gemini = outbound.filter((o) => o.url.includes('generativelanguage'));
    expect(gemini.length).toBeGreaterThan(0);
    for (const o of gemini) expect(JSON.stringify(o.body)).not.toContain('gemini-3.8-flash');
    expect(metas[0]).toMatchObject({ provider: 'nvidia' });
  });
});
