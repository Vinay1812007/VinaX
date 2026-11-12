/**
 * VinaX AI — the Claude adapter, on Anthropic's native Messages API
 * (`POST https://api.anthropic.com/v1/messages`, `stream: true`).
 *
 * Plain fetch, like every other provider here, because the chat hands the
 * provider's own SSE bytes to the page untouched (passthrough.ts: relaying
 * them through JavaScript ran out the free plan's CPU). The official SDK
 * would parse the stream inside the Worker, which is exactly what that
 * avoids. The page reads these lines itself (frontend vinaxai/wire.ts,
 * wire 'anthropic').
 *
 * Request: `system` is a top-level field; images go as base64 `image`
 * blocks before the text. Claude Haiku 4.5 thinks by token budget
 * (`thinking: { type: "enabled", budget_tokens }`, kept under max_tokens);
 * the newer models' thinking is adaptive (Claude decides how much),
 * shown as a summary (`display: "summarized"`; the default "omitted" would
 * look like a long pause). How hard it thinks is `output_config.effort`,
 * set per thinking level in thinking.ts. No `temperature`: the current
 * Claude models refuse sampling parameters. A model whose params carry
 * `fallbacks: "default"` gets the server-side fallback beta header, so a
 * request its safety classifier declines is answered by the model
 * Anthropic recommends for that case, on the same stream.
 *
 * Stream: `message_start` (input tokens), `content_block_delta` with
 * `text_delta` (answer) or `thinking_delta` (reasoning), `message_delta`
 * (stop reason, output tokens), `message_stop`; `ping` is a keep-alive and
 * `error` is a mid-stream failure (classified like an HTTP one). A
 * `refusal` stop reason is a declined request, reported as content_filter.
 */
import { classifyHttp, errorText, ProviderError } from '../errors';
import { parseJson, sseData } from '../sse';
import { ThinkSplitter } from '../think';
import { wireMessages } from '../wire';
import type { AiEnv, ChatRequest, ProviderEvent, WireAdapter } from '../types';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
/** Server-side fallback on a safety refusal (`fallbacks: "default"`). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

interface Event {
  type?: string;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string | null };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

/** Anthropic's error types as the HTTP status they stand for. */
const ERROR_STATUS: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  overloaded_error: 529,
};

export function anthropicBody(req: ChatRequest): Record<string, unknown> {
  const { system, messages } = wireMessages(req.model, req.system, req.messages);
  const merged: Record<string, unknown> = {
    ...(req.model.params ?? {}),
    ...(req.reasoning === 'high' ? req.model.highParams ?? {} : {}),
    ...(req.reasoning === 'off' ? req.model.offParams ?? {} : {}),
  };
  let maxTokens = Math.min(req.maxOutputTokens, req.model.maxOutput);
  // A thinking budget (Claude Haiku 4.5) must be at least 1,024 and below max_tokens:
  // the answer keeps the room it was asked for, the budget fits under the model's ceiling, else no thinking.
  const thinking = merged.thinking as { type?: unknown; budget_tokens?: unknown } | undefined;
  if (thinking?.type === 'enabled' && typeof thinking.budget_tokens === 'number') {
    maxTokens = Math.min(req.model.maxOutput, thinking.budget_tokens + Math.max(1_024, maxTokens));
    const budget = Math.min(thinking.budget_tokens, maxTokens - 1_024);
    if (budget >= 1_024) merged.thinking = { type: 'enabled', budget_tokens: budget };
    else delete merged.thinking;
  }
  return {
    model: req.model.upstream,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: messages.map((msg) => ({
      role: msg.role,
      content: [
        ...(msg.role === 'user' ? msg.images ?? [] : []).map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } })),
        { type: 'text', text: msg.text || '(see the attached files)' },
      ],
    })),
    stream: true,
    ...merged,
  };
}

async function openAnthropic(env: AiEnv, req: ChatRequest): Promise<ReadableStream<Uint8Array>> {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new ProviderError('not_configured');
  const body = anthropicBody(req);
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      ...(body.fallbacks != null ? { 'anthropic-beta': FALLBACK_BETA } : {}),
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw classifyHttp(res.status, res.headers, await errorText(res));
  if (!res.body) throw new ProviderError('empty');
  return res.body;
}

const finish = (r: string | null | undefined): 'stop' | 'length' | 'content_filter' | null =>
  !r ? null : r === 'max_tokens' ? 'length' : r === 'refusal' ? 'content_filter' : 'stop';

/** Reads the Messages API's SSE body into events. */
export async function* parseAnthropicStream(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal): AsyncGenerator<ProviderEvent> {
  const split = new ThinkSplitter();
  let reason: 'stop' | 'length' | 'content_filter' = 'stop';
  let input = 0;
  let output = 0;
  let sawUsage = false;
  for await (const data of sseData(body, signal)) {
    const j = parseJson<Event>(data);
    if (!j) continue;
    if (j.type === 'error' || j.error) {
      throw classifyHttp(ERROR_STATUS[j.error?.type ?? ''] ?? 502, null, String(j.error?.message ?? ''));
    }
    if (j.type === 'message_start' && j.message?.usage) {
      sawUsage = true;
      input = j.message.usage.input_tokens ?? 0;
      output = j.message.usage.output_tokens ?? 0;
    } else if (j.type === 'content_block_delta') {
      if (j.delta?.type === 'thinking_delta' && j.delta.thinking) yield* split.reasoning(j.delta.thinking);
      else if (j.delta?.type === 'text_delta' && j.delta.text) yield* split.push(j.delta.text);
    } else if (j.type === 'message_delta') {
      const f = finish(j.delta?.stop_reason);
      if (f) reason = f;
      if (j.usage) {
        sawUsage = true;
        if (j.usage.input_tokens != null) input = j.usage.input_tokens;
        if (j.usage.output_tokens != null) output = j.usage.output_tokens;
      }
    }
  }
  yield* split.end();
  if (!split.sawText) {
    // A request Claude declined is an answer of its own kind, not a broken model.
    if (reason === 'content_filter') {
      yield { type: 'end', reason };
      return;
    }
    throw new ProviderError('empty');
  }
  if (sawUsage) yield { type: 'usage', input, output };
  yield { type: 'end', reason };
}

export const anthropic: WireAdapter = {
  wire: 'anthropic',
  open: openAnthropic,
  parse: parseAnthropicStream,
  async *stream(env: AiEnv, req: ChatRequest): AsyncGenerator<ProviderEvent> {
    yield* parseAnthropicStream(await openAnthropic(env, req), req.signal);
  },
};
