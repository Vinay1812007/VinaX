/**
 * VinaX AI — the OpenAI-compatible adapter, shared by Groq, OpenRouter and
 * NVIDIA NIM (`/v1/chat/completions`, `stream: true`). Per-provider details
 * are options: the endpoint, the key, extra headers. Per-model details
 * (reasoning switches) come from the registry's `params` / `highParams`.
 *
 * Reasoning arrives as `delta.reasoning` / `delta.reasoning_content`, or as
 * <think> tags inside `delta.content`; ThinkSplitter turns both into
 * `thinking` events. A mid-stream `{ error }` frame (OpenRouter does this)
 * is classified like an HTTP failure.
 */
import { classifyHttp, errorText, ProviderError } from '../errors';
import { parseJson, sseData } from '../sse';
import { ThinkSplitter } from '../think';
import { wireMessages } from '../wire';
import type { Adapter, AiEnv, ChatRequest, ProviderEvent } from '../types';

export interface OpenAiCompatOptions {
  url: string;
  key: (env: AiEnv) => string | undefined;
  headers?: Record<string, string>;
}

interface Chunk {
  choices?: Array<{ delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number } };
  error?: { code?: number | string; message?: string; metadata?: unknown };
}

export function requestBody(req: ChatRequest): Record<string, unknown> {
  const { system, messages } = wireMessages(req.model, req.system, req.messages);
  const wire: Array<{ role: string; content: string }> = [];
  if (system) wire.push({ role: 'system', content: system });
  for (const msg of messages) wire.push({ role: msg.role, content: msg.text });
  return {
    model: req.model.upstream,
    messages: wire,
    stream: true,
    max_tokens: Math.min(req.maxOutputTokens, req.model.maxOutput),
    ...(req.temperature != null ? { temperature: req.temperature } : {}),
    ...(req.model.params ?? {}),
    ...(req.reasoning === 'high' ? req.model.highParams ?? {} : {}),
    ...(req.reasoning === 'off' ? req.model.offParams ?? {} : {}),
  };
}

const finish = (r: string | null | undefined): 'stop' | 'length' | 'content_filter' | null =>
  !r ? null : r === 'length' ? 'length' : r === 'content_filter' ? 'content_filter' : 'stop';

export function openAiCompatAdapter(opts: OpenAiCompatOptions): Adapter {
  return {
    async *stream(env: AiEnv, req: ChatRequest): AsyncGenerator<ProviderEvent> {
      const key = opts.key(env)?.trim();
      if (!key) throw new ProviderError('not_configured');
      const res = await fetch(opts.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${key}`, ...opts.headers },
        body: JSON.stringify(requestBody(req)),
        signal: req.signal,
      });
      if (!res.ok) throw classifyHttp(res.status, res.headers, await errorText(res));
      const split = new ThinkSplitter();
      let reason: 'stop' | 'length' | 'content_filter' = 'stop';
      let usage: { input: number; output: number } | null = null;
      for await (const data of sseData(res.body, req.signal)) {
        const j = parseJson<Chunk>(data);
        if (!j) continue;
        if (j.error) {
          const code = Number(j.error.code);
          throw classifyHttp(Number.isFinite(code) && code >= 400 ? code : 502, null, String(j.error.message ?? ''));
        }
        const choice = j.choices?.[0];
        const delta = choice?.delta;
        const thought = delta?.reasoning ?? delta?.reasoning_content;
        if (thought) yield* split.reasoning(thought);
        if (delta?.content) yield* split.push(delta.content);
        const f = finish(choice?.finish_reason);
        if (f) reason = f;
        const u = j.usage ?? j.x_groq?.usage;
        if (u) usage = { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0 };
      }
      yield* split.end();
      if (!split.sawText) throw new ProviderError('empty');
      if (usage) yield { type: 'usage', ...usage };
      yield { type: 'end', reason };
    },
  };
}

export const groq = openAiCompatAdapter({ url: 'https://api.groq.com/openai/v1/chat/completions', key: (env) => env.GROQ_API_KEY });

export const openrouter = openAiCompatAdapter({
  url: 'https://openrouter.ai/api/v1/chat/completions',
  key: (env) => env.OPENROUTER_API_KEY,
  headers: { 'HTTP-Referer': 'https://www.vinaxmusic.online', 'X-Title': 'VinaX AI' },
});

export const nvidia = openAiCompatAdapter({ url: 'https://integrate.api.nvidia.com/v1/chat/completions', key: (env) => env.NVIDIA_API_KEY });
