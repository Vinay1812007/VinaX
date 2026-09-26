/**
 * 8.0.1 — the maestro transport: whichever endpoint the key's shape needs,
 * one chat-completions answer comes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromNativeAnswer, isModelGone, isWrongDoor, maestroFetch, maestroLearnedMode, maestroModelFor, maestroModes, pickModel, resetMaestroMode, resetMaestroModels, suggestedModel, toNativeRequest } from '../functions/_lib/maestro';

const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
function install(plan: (url: string) => Response): void {
  calls.length = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return plan(url);
  });
}
const nativeOk = (text: string): Response => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6 } }), { status: 200 });
const payload = { model: 'm', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'hi' }], temperature: 0.3, max_tokens: 1924, response_format: { type: 'json_object' }, reasoning_effort: 'low' };

beforeEach(() => { resetMaestroMode(); resetMaestroModels(); });
afterEach(() => vi.unstubAllGlobals());

describe('maestro transport', () => {
  it('orders modes by key shape and puts the learned mode first', () => {
    expect(maestroModes('AIzaXYZ', null)).toEqual(['openai', 'native', 'cloud']);
    expect(maestroModes('AQ.Ab8RN6', null)).toEqual(['native', 'cloud', 'openai']);
    expect(maestroModes('AQ.Ab8RN6', 'cloud')).toEqual(['cloud', 'native', 'openai']);
  });

  it('translates to the native request: system instruction, roles, JSON mode, a thinking budget', () => {
    const req = toNativeRequest(payload) as { systemInstruction: { parts: Array<{ text: string }> }; contents: Array<{ role: string }>; generationConfig: Record<string, unknown> };
    expect(req.systemInstruction.parts[0].text).toBe('Be brief.');
    expect(req.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
    expect(req.generationConfig).toMatchObject({ temperature: 0.3, maxOutputTokens: 1924, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 1024 } });
    expect((toNativeRequest({ ...payload, max_tokens: 4 }) as { generationConfig: { thinkingConfig: { thinkingBudget: number } } }).generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });

  it('reads the native answer back as chat-completions, without thought parts', () => {
    const body = fromNativeAnswer({ candidates: [{ content: { parts: [{ text: 'x', thought: true }, { text: '{"a":1}' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } }, 'm') as { choices: Array<{ message: { content: string }; finish_reason: string }>; usage: unknown };
    expect(body.choices[0].message.content).toBe('{"a":1}');
    expect(body.choices[0].finish_reason).toBe('length');
    expect(body.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2 });
  });

  it('an AQ. key goes to the native endpoint with the key in a header, trimmed', async () => {
    install(() => nativeOk('OK'));
    const res = await maestroFetch('AQ.Ab8RN6Kr-test\n', 'gemini-2.5-flash', payload);
    const j = (await res.json()) as { choices: Array<{ message: { content: string } }>; usage: { completion_tokens: number } };
    expect(j.choices[0].message.content).toBe('OK');
    expect(j.usage.completion_tokens).toBe(10);
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(calls[0].headers['x-goog-api-key']).toBe('AQ.Ab8RN6Kr-test');
    expect(maestroLearnedMode()).toBe('native');
  });

  it('walks to the next endpoint on a wrong-key answer and remembers the one that worked', async () => {
    install((url) => (url.includes('aiplatform') ? nativeOk('from cloud') : new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 })));
    const res = await maestroFetch('AQ.key', 'gemini-2.5-flash', payload);
    expect(((await res.json()) as { choices: Array<{ message: { content: string } }> }).choices[0].message.content).toBe('from cloud');
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['generativelanguage.googleapis.com', 'aiplatform.googleapis.com']);
    expect(calls[1].url).toContain('key=AQ.key');
    expect(maestroLearnedMode()).toBe('cloud');
    calls.length = 0;
    await maestroFetch('AQ.key', 'gemini-2.5-flash', payload);
    expect(new URL(calls[0].url).host).toBe('aiplatform.googleapis.com');
  });

  it('returns a quota answer as it is instead of trying other endpoints', async () => {
    install(() => new Response('quota', { status: 429 }));
    const res = await maestroFetch('AIzaKey', 'm', payload);
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/openai/chat/completions');
  });

  it('retries a native call without a thinking budget when the model refuses one', async () => {
    let n = 0;
    install(() => (n++ === 0 ? new Response('{"error":{"message":"thinking budget is not supported"}}', { status: 400 }) : nativeOk('fine')));
    const res = await maestroFetch('AQ.k', 'm', payload);
    expect(res.status).toBe(200);
    expect((calls[1].body.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
  });

  it('streams the whole answer as one event for streaming callers', async () => {
    install(() => nativeOk('hello'));
    const res = await maestroFetch('AQ.k', 'm', { ...payload, stream: true });
    const text = await res.text();
    expect(text).toContain('"delta":{"content":"hello"}');
    expect(text.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('knows a wrong door from a real error', () => {
    expect(isWrongDoor(403, '')).toBe(true);
    expect(isWrongDoor(400, 'API key not valid. Please pass a valid API key.')).toBe(true);
    expect(isWrongDoor(400, 'Invalid JSON payload')).toBe(false);
    expect(isWrongDoor(429, '')).toBe(false);
  });

  it('8.0.2 — a retired model: follows the name the error suggests and remembers it', async () => {
    const gone = '[{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features","status":"NOT_FOUND"}}]';
    install((url) => (url.includes('gemini-2.5-flash') ? new Response(gone, { status: 404 }) : nativeOk('new model')));
    const res = await maestroFetch('AQ.k', 'gemini-2.5-flash', payload);
    expect(((await res.json()) as { choices: Array<{ message: { content: string } }> }).choices[0].message.content).toBe('new model');
    expect(calls.map((c) => c.url.split('/models/')[1])).toEqual(['gemini-2.5-flash:generateContent', 'gemini-3.8-flash:generateContent']);
    expect(maestroModelFor('gemini-2.5-flash')).toBe('gemini-3.8-flash');
    calls.length = 0;
    await maestroFetch('AQ.k', 'gemini-2.5-flash', payload);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('gemini-3.8-flash');
  });

  it('8.0.2 — a retired model with no suggestion: picks the newest general flash model the key lists', async () => {
    install((url) => {
      if (url.includes('/v1beta/models?')) return new Response(JSON.stringify({ models: ['gemini-2.0-flash', 'gemini-3.9-flash-lite', 'gemini-3.8-flash', 'gemini-4.0-flash-preview', 'gemini-3.8-flash-image', 'text-embedding-9'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) }), { status: 200 });
      if (url.includes('old-model')) return new Response('{"error":{"message":"models/old-model is not found for API version v1beta"}}', { status: 404 });
      return nativeOk('listed');
    });
    const res = await maestroFetch('AQ.k', 'old-model', payload);
    expect(res.status).toBe(200);
    expect(calls.at(-1)!.url).toContain('/models/gemini-3.8-flash:generateContent');
  });

  it('8.0.2 — reads model errors apart from key errors', () => {
    expect(isModelGone(404, 'This model models/x is no longer available to new users')).toBe(true);
    expect(isModelGone(404, 'Requested entity was not found.')).toBe(false);
    expect(isModelGone(400, 'API key not valid')).toBe(false);
    expect(suggestedModel('Please update your code to use models/gemini-3.8-flash for the latest features')).toBe('gemini-3.8-flash');
    expect(suggestedModel('nothing here')).toBeNull();
    expect(pickModel(['models/gemini-3.8-flash-lite', 'models/gemini-3.8-flash', 'models/gemini-3.9-flash-preview', 'models/gemini-2.5-flash'])).toBe('gemini-3.8-flash');
    expect(pickModel(['models/gemini-3.9-flash-preview'])).toBe('gemini-3.9-flash-preview');
    expect(pickModel(['models/text-embedding'])).toBeNull();
  });
});
