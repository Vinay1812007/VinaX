/**
 * v5.16.0 — token usage: chat() reads the provider's usage block and hands it
 * back with the content, and the 14.0 call log records it per attempt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, usageFromJson } from '../functions/_lib/ai';

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

describe('chat() usage passthrough', () => {
  it('returns the provider usage alongside the content', async () => {
    installFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 40, completion_tokens: 2 } }), { status: 200 }));
    const r = await chat({ VINAX_NVIDIA_API_KEY: 'k' }, [{ role: 'user', content: 'x' }], { lane: 'fast' });
    expect(r.content).toBe('hi');
    expect(r.usage).toEqual({ prompt_tokens: 40, completion_tokens: 2 });
  });
  it('leaves usage undefined when the provider sent none', async () => {
    installFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 }));
    const r = await chat({ VINAX_NVIDIA_API_KEY: 'k' }, [{ role: 'user', content: 'x' }], { lane: 'fast' });
    expect(r.usage).toBeUndefined();
  });
});
