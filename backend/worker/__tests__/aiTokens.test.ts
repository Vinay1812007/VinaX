/**
 * v5.16.0 — token accounting: provider usage reaches vinax_ai_events from
 * both the non-streaming chat() helper and the streaming assistant, and an
 * older table (no token columns yet) keeps accepting every row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiEventRow, chat, logAiEvent, usageFromJson } from '../functions/_lib/ai';
import { onRequestPost } from '../functions/api/vinaxai';

interface Call { url: string; method: string; body: Record<string, unknown> | null }
const calls: Call[] = [];

function installFetch(plan: (url: string, body: Record<string, unknown> | null) => Response): void {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let body: Record<string, unknown> | null;
    try {
      body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    calls.push({ url, method: init?.method ?? 'GET', body });
    return Promise.resolve(plan(url, body));
  });
}

const llmCalls = (): Call[] => calls.filter((c) => c.url.includes('/chat/completions'));
const logRows = (): Array<Record<string, unknown>> =>
  calls.filter((c) => c.method === 'POST' && c.url.includes('vinax_ai_events')).map((c) => c.body ?? {});

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('usageFromJson', () => {
  it('reads the OpenAI-compatible usage block and the scholar provider envelope', () => {
    expect(usageFromJson({ usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 } })).toEqual({ prompt_tokens: 12, completion_tokens: 34 });
    expect(usageFromJson({ choices: [], x_groq: { usage: { prompt_tokens: 5, completion_tokens: 6 } } })).toEqual({ prompt_tokens: 5, completion_tokens: 6 });
  });
  it('refuses partial or malformed usage', () => {
    expect(usageFromJson({ usage: { prompt_tokens: 12 } })).toBeNull();
    expect(usageFromJson({ usage: { prompt_tokens: '12', completion_tokens: 3 } })).toBeNull();
    expect(usageFromJson({ usage: null })).toBeNull();
    expect(usageFromJson(null)).toBeNull();
  });
});

describe('logAiEvent', () => {
  const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
  const base = { feature: 'dj' as const, model: 'm @dj', ok: true, client: 'web' as const, latency_ms: 10 };

  it('omits the token columns when the provider sent no usage', () => {
    const row = aiEventRow(base);
    expect('prompt_tokens' in row).toBe(false);
    expect('completion_tokens' in row).toBe(false);
    expect('prompt_tokens' in aiEventRow({ ...base, prompt_tokens: 5 })).toBe(false); // half a usage block is no usage
    expect(aiEventRow({ ...base, prompt_tokens: 5, completion_tokens: 7 })).toMatchObject({ prompt_tokens: 5, completion_tokens: 7 });
  });

  it('retries once without the token columns when the table predates them', async () => {
    installFetch((_url, body) => new Response(body && 'prompt_tokens' in body ? 'column does not exist' : '', { status: body && 'prompt_tokens' in body ? 400 : 201 }));
    await logAiEvent(ENV, { ...base, prompt_tokens: 5, completion_tokens: 7 });
    const rows = logRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ prompt_tokens: 5, completion_tokens: 7 });
    expect('prompt_tokens' in rows[1]).toBe(false);
    expect(rows[1]).toMatchObject({ feature: 'dj', model: 'm @dj' });
  });

  it('writes once when the insert with tokens succeeds', async () => {
    installFetch(() => new Response('', { status: 201 }));
    await logAiEvent(ENV, { ...base, prompt_tokens: 5, completion_tokens: 7 });
    expect(logRows()).toHaveLength(1);
  });
});

describe('chat() usage passthrough', () => {
  it('returns the provider usage alongside the content', async () => {
    installFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 40, completion_tokens: 2 } }), { status: 200 }));
    const r = await chat({ VINAX_OAI_GPT_OSS_20B: 'k' }, [{ role: 'user', content: 'x' }], { lane: 'fast' });
    expect(r.content).toBe('hi');
    expect(r.usage).toEqual({ prompt_tokens: 40, completion_tokens: 2 });
  });
  it('leaves usage undefined when the provider sent none', async () => {
    installFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 }));
    const r = await chat({ VINAX_OAI_GPT_OSS_20B: 'k' }, [{ role: 'user', content: 'x' }], { lane: 'fast' });
    expect(r.usage).toBeUndefined();
  });
});

describe('streaming assistant usage', () => {
  const SB = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
  const DEFAULT_BASE_ENV = { ...SB, VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k-chat' };
  const SCHOLAR_ONLY_ENV = { ...SB, VINAX_GROQ_API_KEY: 'k-scholar' };

  const sse = (chunks: string[], tail: Record<string, unknown>[] = []): Response =>
    new Response(
      chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') +
        tail.map((t) => `data: ${JSON.stringify(t)}\n\n`).join('') +
        'data: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );

  let ipSeq = 0;
  const chatRequest = (): Request => {
    ipSeq += 1;
    return new Request('https://example.test/api/vinaxai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.5.${Math.floor(ipSeq / 250)}.${ipSeq % 250}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello there' }], mode: 'muse' }),
    });
  };

  async function drive(env: Record<string, string>): Promise<{ status: number; text: string }> {
    const pending: Promise<unknown>[] = [];
    const res = await onRequestPost({ request: chatRequest(), env, waitUntil: (p) => void pending.push(p) });
    const raw = await res.text();
    await Promise.all(pending);
    const text = raw
      .split('\n\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => (JSON.parse(l.slice(6)) as { delta?: string }).delta ?? '')
      .join('');
    return { status: res.status, text };
  }

  it('asks the default base for a usage chunk and logs the counts it returns', async () => {
    installFetch((url) => {
      if (url.includes('/chat/completions')) return sse(['Hello ', 'there'], [{ choices: [], usage: { prompt_tokens: 120, completion_tokens: 8 } }]);
      return new Response('', { status: 201 });
    });
    const { status, text } = await drive(DEFAULT_BASE_ENV);
    expect(status).toBe(200);
    expect(text).toBe('Hello there');
    expect(llmCalls()).toHaveLength(1);
    expect(llmCalls()[0].body?.stream_options).toEqual({ include_usage: true });
    const final = logRows().find((r) => r.error === null);
    expect(final).toMatchObject({ feature: 'assistant', ok: true, prompt_tokens: 120, completion_tokens: 8 });
  });

  it('keeps the scholar lane request unchanged and still reads its own usage envelope', async () => {
    installFetch((url) => {
      if (url.includes('/chat/completions')) return sse(['scholar reply'], [{ choices: [{ delta: {} }], x_groq: { usage: { prompt_tokens: 30, completion_tokens: 4 } } }]);
      return new Response('', { status: 201 });
    });
    const { text } = await drive(SCHOLAR_ONLY_ENV);
    expect(text).toBe('scholar reply');
    const call = llmCalls()[0];
    expect(call.url).toContain('api.groq.com');
    expect('stream_options' in (call.body ?? {})).toBe(false);
    expect(logRows().find((r) => r.error === null)).toMatchObject({ prompt_tokens: 30, completion_tokens: 4 });
  });

  it('a 400 with the usage opt-in re-asks the same pair plainly before walking the ladder', async () => {
    installFetch((url, body) => {
      if (!url.includes('/chat/completions')) return new Response('', { status: 201 });
      if (body && 'stream_options' in body) return new Response('unknown field stream_options', { status: 400 });
      return sse(['plain answer']);
    });
    const { status, text } = await drive(DEFAULT_BASE_ENV);
    expect(status).toBe(200);
    expect(text).toBe('plain answer');
    const [first, second] = llmCalls();
    expect(first.body?.stream_options).toBeDefined();
    expect(second.body?.stream_options).toBeUndefined();
    expect(second.body?.model).toBe(first.body?.model);
    // No usage arrived, so the final row carries no token columns.
    const final = logRows().find((r) => r.error === null);
    expect(final).toBeDefined();
    expect('prompt_tokens' in (final ?? {})).toBe(false);
  });
});
