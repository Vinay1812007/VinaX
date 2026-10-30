/**
 * VinaX AI — each provider adapter against recorded streams: reasoning in a
 * field, in <think> tags split across chunks, in Gemini thought parts;
 * quota and rate errors; Workers AI's 4006 / 5007.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gemini, geminiBody } from '../functions/_lib/ai/adapters/gemini';
import { groq, nvidia, openrouter, requestBody } from '../functions/_lib/ai/adapters/openaiCompat';
import { workersAi, workersAiError } from '../functions/_lib/ai/adapters/workersAi';
import { ProviderError, classifyHttp, nextUtcMidnight } from '../functions/_lib/ai/errors';
import { MODELS, modelById } from '../functions/_lib/ai/models';
import type { Adapter, AiEnv, ChatRequest, ModelSpec, ProviderEvent } from '../functions/_lib/ai/types';
import { fixture, sseResponse, streamOf } from './helpers/aiStreams';

const spec = (id: string): ModelSpec => modelById(MODELS, id)!;
const req = (id: string, over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: spec(id), system: 'SYSTEM', messages: [{ role: 'user', text: 'hi' }], maxOutputTokens: 1024,
  reasoning: 'default', webSearch: false, signal: new AbortController().signal, ...over,
});
const ENV: AiEnv = { GROQ_API_KEY: 'gsk_test', GEMINI_API_KEY: 'gem_test', OPENROUTER_API_KEY: 'or_test', NVIDIA_API_KEY: 'nv_test' };

async function collect(adapter: Adapter, env: AiEnv, r: ChatRequest): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const ev of adapter.stream(env, r)) out.push(ev);
  return out;
}
const joined = (events: ProviderEvent[], type: 'text' | 'thinking') => events.filter((e) => e.type === type).map((e) => (e as { delta: string }).delta).join('');

function stubFetch(res: () => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return res();
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI-compatible adapters', () => {
  it('Groq: reasoning field becomes thinking, content becomes text, x_groq usage is read', async () => {
    const calls = stubFetch(() => sseResponse(fixture('groq-gpt-oss.sse'), 3));
    const events = await collect(groq, ENV, req('groq:openai/gpt-oss-120b'));
    expect(joined(events, 'thinking')).toBe('The user asks about Yaman. It is an evening raga.');
    expect(joined(events, 'text')).toBe('Yaman is an evening raga.');
    expect(events.at(-2)).toEqual({ type: 'usage', input: 812, output: 41 });
    expect(events.at(-1)).toEqual({ type: 'end', reason: 'stop' });
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer gsk_test');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ model: 'openai/gpt-oss-120b', stream: true, include_reasoning: true, reasoning_effort: 'medium' });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
  });

  it('Extended thinking sends the high-reasoning params', () => {
    expect(requestBody(req('groq:openai/gpt-oss-120b', { reasoning: 'high' }))).toMatchObject({ reasoning_effort: 'high' });
  });

  it('NVIDIA: <think> tags split across chunks never reach the answer', async () => {
    for (const size of [1, 4, 9, 64]) {
      stubFetch(() => sseResponse(fixture('nvidia-think-tags.sse'), size));
      const events = await collect(nvidia, ENV, req('nvidia:nvidia/nemotron-3.5-lightning-30b-a3b'));
      expect(joined(events, 'thinking'), `size ${size}`).toBe('Count the letters: s-t-r-a-w-b-e-r-r-y.');
      expect(joined(events, 'text'), `size ${size}`).toBe('There are three r\'s in "strawberry".');
      expect(events.at(-1)).toEqual({ type: 'end', reason: 'length' });
    }
  });

  it('NVIDIA: reasoning_content is thinking', async () => {
    stubFetch(() => sseResponse(fixture('nvidia-reasoning-content.sse')));
    const events = await collect(nvidia, ENV, req('nvidia:nvidia/nemotron-3-ultra-550b-a55b'));
    expect(joined(events, 'thinking')).toBe('Thinking about it.');
    expect(joined(events, 'text')).toBe('Hello there.');
  });

  it('a think-only stream is an empty answer (the router fails over)', async () => {
    stubFetch(() => sseResponse(fixture('nvidia-think-only.sse')));
    await expect(collect(nvidia, ENV, req('nvidia:nvidia/nemotron-3-ultra-550b-a55b'))).rejects.toMatchObject({ kind: 'empty' });
  });

  it('OpenRouter: sends its attribution headers; a mid-stream daily-limit error is a quota failure', async () => {
    const calls = stubFetch(() => sseResponse(fixture('openrouter-midstream-error.sse')));
    await expect(collect(openrouter, ENV, req('openrouter:cohere/north-mini-code:free'))).rejects.toMatchObject({ kind: 'quota', status: 429 });
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['HTTP-Referer']).toBe('https://www.vinaxmusic.online');
    expect(h['X-Title']).toBe('VinaX AI');
  });

  it('an HTTP 429 with retry advice is a rate failure with its wait', async () => {
    stubFetch(() => new Response(fixture('groq-429-rate.json'), { status: 429 }));
    await expect(collect(groq, ENV, req('groq:openai/gpt-oss-120b'))).rejects.toMatchObject({ kind: 'rate', retryAfterMs: 2500 });
  });

  it('a missing key fails before any request', async () => {
    const calls = stubFetch(() => sseResponse(''));
    await expect(collect(groq, {}, req('groq:openai/gpt-oss-120b'))).rejects.toMatchObject({ kind: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('models without a system role get the system text in the first user turn', () => {
    const noSystem = { ...spec('groq:openai/gpt-oss-20b'), flags: { ...spec('groq:openai/gpt-oss-20b').flags, systemRole: false } };
    const body = requestBody({ ...req('groq:openai/gpt-oss-20b'), model: noSystem }) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages).toEqual([{ role: 'user', content: 'SYSTEM\n\n---\n\nhi' }]);
  });
});

describe('Gemini adapter', () => {
  it('thought parts are thinking; the key goes in a header, never the URL', async () => {
    const calls = stubFetch(() => sseResponse(fixture('gemini-thoughts.sse'), 5));
    const events = await collect(gemini, ENV, req('gemini:gemini-3.5-flash'));
    expect(joined(events, 'thinking')).toBe('**Weighing the question** The user wants a short answer.');
    expect(joined(events, 'text')).toBe('A raga is a melodic framework.');
    expect(events.at(-2)).toEqual({ type: 'usage', input: 120, output: 39 });
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse');
    expect(calls[0].url).not.toContain('gem_test');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('gem_test');
  });

  it('builds systemInstruction, model turns and thinkingConfig', () => {
    const body = geminiBody(req('gemini:gemini-3.6-flash', { reasoning: 'high', messages: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'c' }] })) as { systemInstruction: unknown; contents: Array<{ role: string }>; generationConfig: { thinkingConfig: unknown } };
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'SYSTEM' }] });
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'high' });
  });

  it('a free-tier daily quota 429 is a quota failure', async () => {
    stubFetch(() => new Response(fixture('gemini-429.json'), { status: 429 }));
    await expect(collect(gemini, ENV, req('gemini:gemini-3.5-flash'))).rejects.toMatchObject({ kind: 'quota', retryAfterMs: 37_000 });
  });
});

describe('Workers AI adapter', () => {
  const env = (run: (model: string, input: Record<string, unknown>) => Promise<unknown>): AiEnv => ({ AI: { run } });

  it('streams `response` frames as text', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const events = await collect(workersAi, env(async (_m, input) => { seen.push(input); return streamOf(fixture('workersai.sse'), 4); }), req('cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast'));
    expect(joined(events, 'text')).toBe('Hello from the edge.');
    expect(events.at(-2)).toEqual({ type: 'usage', input: 10, output: 5 });
    expect(seen[0]).toMatchObject({ stream: true, messages: [{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'hi' }] });
  });

  it('4006 (daily pool spent) rests until 00:00 UTC; 5007 (unknown model) rests a day', async () => {
    const now = Date.UTC(2026, 9, 30, 15, 0, 0);
    expect(workersAiError(new Error('AiError: 4006: you have used up your daily free allocation of 10,000 neurons'), now)).toMatchObject({ kind: 'quota', untilMs: nextUtcMidnight(now) });
    expect(nextUtcMidnight(now)).toBe(Date.UTC(2026, 9, 31));
    expect(workersAiError(new Error('AiError: 5007: No such model @cf/x'), now)).toMatchObject({ kind: 'gone', untilMs: now + 86_400_000 });
    await expect(collect(workersAi, env(async () => { throw new Error('4006: neurons'); }), req('cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast'))).rejects.toMatchObject({ kind: 'quota' });
  });

  it('is not configured without the binding', async () => {
    await expect(collect(workersAi, {}, req('cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast'))).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('classifyHttp', () => {
  it.each([
    [404, 'gone'], [410, 'gone'], [401, 'auth'], [402, 'auth'], [403, 'forbidden'], [500, 'upstream'], [503, 'upstream'], [400, 'bad_request'],
  ])('%i → %s', (status, kind) => {
    expect(classifyHttp(status, null, '').kind).toBe(kind);
  });
  it('reads retry-after seconds', () => {
    expect(classifyHttp(429, new Headers({ 'retry-after': '12' }), '').retryAfterMs).toBe(12_000);
  });
});
