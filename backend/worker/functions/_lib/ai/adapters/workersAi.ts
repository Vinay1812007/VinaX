/**
 * VinaX AI — the Cloudflare Workers AI adapter, through the `AI` binding
 * (`env.AI.run(model, { messages, stream: true, max_tokens })`), which
 * answers a ReadableStream of SSE `data: {"response": "…"}` frames.
 *
 * The free pool is about 10,000 neurons a day for the whole account, so it
 * sits last in the default ladder. Error 4006 means the pool is spent (rest
 * until 00:00 UTC); 5007 means the model id is unknown (rest a day).
 */
import { nextUtcMidnight, ProviderError } from '../errors';
import { parseJson, sseData } from '../sse';
import { ThinkSplitter } from '../think';
import { wireMessages } from '../wire';
import type { Adapter, AiEnv, ChatRequest, ProviderEvent } from '../types';

const DAY_MS = 24 * 60 * 60_000;

/** Map a binding error (its message carries Cloudflare's code) to a ProviderError. */
export function workersAiError(e: unknown, now = Date.now()): ProviderError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/\b4006\b|neurons|free allocation|daily free/i.test(msg)) return new ProviderError('quota', { status: 429, untilMs: nextUtcMidnight(now) });
  if (/\b5007\b|no such model|model not found/i.test(msg)) return new ProviderError('gone', { status: 404, untilMs: now + DAY_MS });
  if (/\b3036\b|rate limit|too many requests/i.test(msg)) return new ProviderError('rate', { status: 429 });
  if (/\b500\d\b|bad input|too long|context|validation/i.test(msg)) return new ProviderError('bad_request', { status: 400 });
  return new ProviderError('upstream', { status: 503 });
}

interface Frame {
  response?: string;
  reasoning_content?: string;
  choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export const workersAi: Adapter = {
  async *stream(env: AiEnv, req: ChatRequest): AsyncGenerator<ProviderEvent> {
    if (!env.AI || typeof env.AI.run !== 'function') throw new ProviderError('not_configured');
    const { system, messages } = wireMessages(req.model, req.system, req.messages);
    const wire = [...(system ? [{ role: 'system', content: system }] : []), ...messages.map((msg) => ({ role: msg.role, content: msg.text }))];
    let out: unknown;
    try {
      out = await env.AI.run(req.model.upstream, { messages: wire, stream: true, max_tokens: Math.min(req.maxOutputTokens, req.model.maxOutput) });
    } catch (e) {
      throw workersAiError(e);
    }
    if (!(out instanceof ReadableStream)) throw new ProviderError('upstream', { status: 502 });
    const split = new ThinkSplitter();
    let usage: { input: number; output: number } | null = null;
    let reason: 'stop' | 'length' = 'stop';
    try {
      for await (const data of sseData(out as ReadableStream<Uint8Array>, req.signal)) {
        const j = parseJson<Frame>(data);
        if (!j) continue;
        const thought = j.reasoning_content ?? j.choices?.[0]?.delta?.reasoning_content;
        if (thought) yield* split.reasoning(thought);
        const text = j.response ?? j.choices?.[0]?.delta?.content;
        if (text) yield* split.push(text);
        if (j.choices?.[0]?.finish_reason === 'length') reason = 'length';
        if (j.usage) usage = { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 };
      }
    } catch (e) {
      if (e instanceof ProviderError || req.signal.aborted) throw e;
      throw workersAiError(e);
    }
    yield* split.end();
    if (!split.sawText) throw new ProviderError('empty');
    if (usage) yield { type: 'usage', ...usage };
    yield { type: 'end', reason };
  },
};
