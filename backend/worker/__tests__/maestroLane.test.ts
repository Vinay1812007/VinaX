/**
 * 8.0.0 — the maestro lane: its own host, its thinking knob, the model
 * override var, and the per-isolate 429 cooldown that keeps a small quota
 * from costing every call a wasted round trip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, clearLaneCooldowns, laneAttempts, laneModel, type AiEnv } from '../functions/_lib/ai';

const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

function install(plan: (url: string) => Response): void {
  calls.length = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return plan(url);
  });
}

const ok = (content: string): Response => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const env: AiEnv = { VINAX_GGL_GEMINI_API_KEY: 'g', VINAX_GROQ_API_KEY: 'q' };

beforeEach(() => clearLaneCooldowns());
afterEach(() => vi.unstubAllGlobals());

describe('maestro lane', () => {
  it('signs against its own host with a thinking cap and output headroom', async () => {
    install(() => ok('{"a":1}'));
    const r = await chat(env, [{ role: 'user', content: 'x' }], { lane: 'maestro', json: true, maxTokens: 900, skipSecondary: true, ladder: [] });
    expect(r.content).toBe('{"a":1}');
    expect(r.keyRole).toBe('maestro');
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(calls[0].body).toMatchObject({ model: 'gemini-2.5-flash', reasoning_effort: 'low', max_tokens: 1924, response_format: { type: 'json_object' } });
    expect(calls[0].body).not.toHaveProperty('chat_template_kwargs');
  });

  it('honours VINAX_MAESTRO_MODEL and ignores a malformed one', () => {
    expect(laneModel({ ...env, VINAX_MAESTRO_MODEL: 'gemini-3-flash' }, 'maestro')).toBe('gemini-3-flash');
    expect(laneModel({ ...env, VINAX_MAESTRO_MODEL: 'bad model; drop' }, 'maestro')).toBe('gemini-2.5-flash');
    expect(laneModel({ ...env, VINAX_MAESTRO_MODEL: 'gemini-3-flash' }, 'scholar')).not.toBe('gemini-3-flash');
    expect(laneAttempts({ ...env, VINAX_MAESTRO_MODEL: 'gemini-3-flash' }, 'maestro', undefined, [])[0].model).toBe('gemini-3-flash');
  });

  it('is skipped without a round trip when its key is missing', () => {
    const attempts = laneAttempts({ VINAX_GROQ_API_KEY: 'q' }, 'maestro', undefined, ['scholar']);
    expect(attempts.map((a) => a.role)).toEqual(['scholar']);
  });

  it('cools a 429 key for a minute: the next call goes straight to the failover', async () => {
    install((url) => (url.includes('generativelanguage') ? new Response('quota', { status: 429 }) : ok('fallback')));
    const opts = { lane: 'maestro' as const, skipSecondary: true, ladder: ['scholar' as const] };
    const first = await chat(env, [{ role: 'user', content: 'x' }], opts);
    expect(first.keyRole).toBe('scholar');
    expect(calls.map((c) => c.url.includes('generativelanguage'))).toEqual([true, false]);
    const second = await chat(env, [{ role: 'user', content: 'x' }], opts);
    expect(second.content).toBe('fallback');
    expect(calls.slice(2).map((c) => c.url.includes('generativelanguage'))).toEqual([false]);
  });
});
