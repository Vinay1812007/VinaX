/**
 * 11.2 — the fifth free provider: Cloudflare Workers AI, through the Worker's
 * own AI binding (`[ai] binding = "AI"` in wrangler.toml). No key, no secret:
 * the provider is "configured" exactly when the binding exists.
 *
 * The free allowance is one pool per account — 10,000 neurons a day, reset at
 * 00:00 UTC — shared by every model. So Workers AI is offered ONLY as an
 * explicit pick in the model menu: it is in no failover ladder and never the
 * automatic choice.
 *
 * The models: a SHORT curated list of well-established text-generation models
 * (original names and makers below). The binding's own listing (`AI.models()`,
 * when the runtime has it) is used only to drop a curated model the account no
 * longer lists; it never adds unreviewed rows. A model that answers "no such
 * model" rests for a day and leaves the list meanwhile (see _lib/ai.ts,
 * noteFailure).
 *
 * The transport: workersAiFetch() runs `AI.run(model, { messages, stream,
 * max_tokens, temperature })` and returns a Response in the chat-completions
 * shape every caller already reads — an OpenAI-shaped SSE stream for
 * `stream: true`, a chat-completions JSON body otherwise — the same precedent
 * as the maestro transport (./maestro.ts). Binding errors become HTTP statuses
 * the cooldown table understands (429 for a spent allowance, 404 for a missing
 * model, 503 for capacity, 400 for a bad input, 502 for anything else).
 */

/** The Worker's AI binding, as much of it as VinaX uses. `models()` is newer
 *  than `run()` and may be absent. */
export interface WorkersAiBinding {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  models?(params?: Record<string, unknown>): Promise<unknown>;
}

/** The base a Workers AI attempt carries instead of a URL (see LANE_BASE in
 *  _lib/ai.ts). Not fetchable: a call that bypassed the transport fails
 *  instead of sending anything anywhere. */
export const WORKERS_AI_BASE = 'workers-ai://binding';
export function isWorkersAiEndpoint(url: string): boolean {
  return url.startsWith('workers-ai://');
}

/** A real binding (an object with a run function). */
export function workersAiBinding(env: object): WorkersAiBinding | null {
  const ai = (env as { AI?: unknown }).AI;
  return ai && typeof (ai as { run?: unknown }).run === 'function'
    ? (ai as WorkersAiBinding)
    : null;
}

export interface WorkersAiModel {
  id: string;
  name: string;
  maker: string;
}

/** 11.2 — the curated chat models, cheapest-to-run first within each maker
 *  family kept close to the provider's own catalogue names. */
export const WORKERS_AI_MODELS: readonly WorkersAiModel[] = [
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    name: 'Llama 3.3 70B Instruct (fp8, fast)',
    maker: 'Meta',
  },
  {
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    name: 'Llama 4 Scout 17B 16E Instruct',
    maker: 'Meta',
  },
  {
    id: '@cf/meta/llama-3.1-8b-instruct-fast',
    name: 'Llama 3.1 8B Instruct (fast)',
    maker: 'Meta',
  },
  {
    id: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    name: 'Mistral Small 3.1 24B Instruct',
    maker: 'Mistral',
  },
  { id: '@cf/google/gemma-3-12b-it', name: 'Gemma 3 12B IT', maker: 'Google' },
  { id: '@cf/qwen/qwq-32b', name: 'QwQ 32B', maker: 'Qwen' },
  { id: '@cf/qwen/qwen2.5-coder-32b-instruct', name: 'Qwen2.5 Coder 32B Instruct', maker: 'Qwen' },
  {
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 Distill Qwen 32B',
    maker: 'DeepSeek',
  },
  { id: '@cf/openai/gpt-oss-120b', name: 'gpt-oss-120b', maker: 'OpenAI' },
  { id: '@cf/openai/gpt-oss-20b', name: 'gpt-oss-20b', maker: 'OpenAI' },
];

/** The text-generation slugs in a binding listing (`AI.models()` rows carry the
 *  slug in `name` and the task in `task.name`). Pure, exported for tests. */
export function parseWorkersAiListing(body: unknown): Set<string> {
  const rows = Array.isArray(body)
    ? body
    : Array.isArray((body as { result?: unknown })?.result)
      ? (body as { result: unknown[] }).result
      : [];
  const out = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const row = r as { name?: unknown; task?: { name?: unknown } | null };
    if (typeof row.name !== 'string' || !/^@(cf|hf)\//.test(row.name)) continue;
    if (row.task?.name !== 'Text Generation') continue;
    out.add(row.name);
  }
  return out;
}

/** The curated list, minus anything a successful, non-empty binding listing
 *  leaves out. A failed or empty listing changes nothing. */
export async function workersAiCatalog(ai: WorkersAiBinding | null): Promise<WorkersAiModel[]> {
  if (!ai) return [];
  if (typeof ai.models !== 'function') return [...WORKERS_AI_MODELS];
  try {
    const listed = parseWorkersAiListing(
      await ai.models({ task: 'Text Generation', per_page: 1000 }),
    );
    if (!listed.size) return [...WORKERS_AI_MODELS];
    const kept = WORKERS_AI_MODELS.filter((m) => listed.has(m.id));
    return kept.length ? kept : [...WORKERS_AI_MODELS];
  } catch {
    return [...WORKERS_AI_MODELS];
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Seconds until the allowance resets (00:00 UTC). */
export function secondsToUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(60, Math.ceil((next - now) / 1000));
}

/** A binding error as the HTTP status the cooldown table understands. Pure. */
export function workersAiErrorStatus(message: string): number {
  if (
    /\b4006\b|neurons|free allocation|\b3036\b|account limited|rate limit|too many requests/i.test(
      message,
    )
  )
    return 429;
  if (/\b5007\b|no such model|model not found|not found/i.test(message)) return 404;
  if (/\b3040\b|capacity|\b3043\b|internal server error|unavailable|timed? ?out/i.test(message))
    return 503;
  if (
    /\b500[0-9]\b|\b502[0-9]\b|bad input|invalid input|too long|context|validation/i.test(message)
  )
    return 400;
  return 502;
}

/** 11.2 — the account's pool is shared by every model: once it is spent, every
 *  call this isolate makes before the reset answers 429 at once instead of
 *  spending a round trip. */
let spentUntil = 0;
/** Test hook. */
export function resetWorkersAi(): void {
  spentUntil = 0;
}

const SPENT = 'the free allocation for today is used up; it resets at 00:00 UTC';
const isSpent = (message: string): boolean => /\b4006\b|neurons|free allocation/i.test(message);

function errorResponse(
  status: number,
  message: string,
  now = Date.now(),
  untilReset = false,
): Response {
  const err: Record<string, unknown> = {
    message: `Workers AI: ${message.slice(0, 200)}`,
    code: status,
  };
  // A spent allowance waits for the reset: the cooldown table reads retryDelay
  // (capped there at 6 h). A plain rate limit keeps the ordinary 60 s.
  if (untilReset) err.details = [{ retryDelay: `${secondsToUtcMidnight(now)}s` }];
  return new Response(JSON.stringify({ error: err }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Messages and answers
// ---------------------------------------------------------------------------

interface InMessage {
  role?: unknown;
  content?: unknown;
}

/** Chat messages as plain text: content parts keep their text, images are
 *  dropped (no curated model is offered as vision-capable). */
export function plainMessages(messages: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(messages)) return [];
  const out: Array<{ role: string; content: string }> = [];
  for (const m of messages as InMessage[]) {
    const role = m?.role === 'system' || m?.role === 'assistant' ? m.role : 'user';
    let content = '';
    if (typeof m?.content === 'string') content = m.content;
    else if (Array.isArray(m?.content))
      content = (m.content as Array<{ type?: unknown; text?: unknown }>)
        .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('\n');
    out.push({ role, content });
  }
  return out;
}

/** The text one streamed frame adds, in any of the shapes Workers AI models
 *  emit: `{ response }` (classic), `choices[0].delta.content` (the
 *  OpenAI-compatible models) or a Responses-API `output_text.delta`. Reasoning
 *  fields are not answer text and are left out. Pure. */
export function frameText(frame: unknown): string {
  if (!frame || typeof frame !== 'object') return '';
  const f = frame as {
    response?: unknown;
    choices?: Array<{ delta?: { content?: unknown }; text?: unknown }>;
    type?: unknown;
    delta?: unknown;
  };
  if (typeof f.response === 'string') return f.response;
  const choice = Array.isArray(f.choices) ? f.choices[0] : undefined;
  if (choice && typeof choice.delta?.content === 'string') return choice.delta.content;
  if (choice && typeof choice.text === 'string') return choice.text;
  if (f.type === 'response.output_text.delta' && typeof f.delta === 'string') return f.delta;
  return '';
}

/** The whole answer of a non-streamed run, in the same shapes. Pure. */
export function resultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const r = result as {
    response?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
    output_text?: unknown;
    output?: unknown;
  };
  if (typeof r.response === 'string') return r.response;
  if (r.response && typeof r.response === 'object') return JSON.stringify(r.response);
  const msg = Array.isArray(r.choices) ? r.choices[0]?.message?.content : undefined;
  if (typeof msg === 'string') return msg;
  if (typeof r.output_text === 'string') return r.output_text;
  if (Array.isArray(r.output)) {
    const texts: string[] = [];
    for (const item of r.output as Array<{
      type?: unknown;
      content?: Array<{ type?: unknown; text?: unknown }>;
    }>) {
      if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const c of item.content)
        if (c?.type === 'output_text' && typeof c.text === 'string') texts.push(c.text);
    }
    return texts.join('');
  }
  return '';
}

/** `{ prompt_tokens, completion_tokens }` when a frame or result carries both. */
function usageOf(o: unknown): { prompt_tokens: number; completion_tokens: number } | null {
  const u = (
    o as {
      usage?: {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        input_tokens?: unknown;
        output_tokens?: unknown;
      };
    } | null
  )?.usage;
  if (!u || typeof u !== 'object') return null;
  const p = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : u.input_tokens;
  const c = typeof u.completion_tokens === 'number' ? u.completion_tokens : u.output_tokens;
  return typeof p === 'number' && typeof c === 'number' && p >= 0 && c >= 0
    ? { prompt_tokens: Math.round(p), completion_tokens: Math.round(c) }
    : null;
}

const sse = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;
const chunk = (model: string, content: string): string =>
  sse({
    object: 'chat.completion.chunk',
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  });

/** The binding's SSE stream re-framed as chat-completions SSE: one content
 *  chunk per frame with text, a usage chunk when the provider sent usage,
 *  then [DONE]. Exported for tests. */
export function toChatStream(
  source: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = source.getReader();
  let buf = '';
  let usage: { prompt_tokens: number; completion_tokens: number } | null = null;
  let done = false;
  const handle = (line: string, out: string[]): void => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const data = t.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    const text = frameText(frame);
    if (text) out.push(chunk(model, text));
    usage = usageOf(frame) ?? usage;
  };
  return new ReadableStream<Uint8Array>({
    // Reads until a chunk can be handed on: a pull that enqueues nothing is
    // not called again by the runtime, so a partial line must not end it.
    async pull(controller) {
      const out: string[] = [];
      while (!done && !out.length) await step(out);
      if (out.length) controller.enqueue(enc.encode(out.join('')));
      if (done) controller.close();
    },
    cancel(reason) {
      done = true;
      return reader.cancel(reason);
    },
  });
  async function step(out: string[]): Promise<void> {
    const { value, done: end } = await reader.read();
    if (value) {
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) handle(l, out);
    }
    if (end) {
      if (buf) handle(buf, out);
      buf = '';
      out.push(
        sse({
          object: 'chat.completion.chunk',
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }),
      );
      if (usage) out.push(sse({ object: 'chat.completion.chunk', model, choices: [], usage }));
      out.push('data: [DONE]\n\n');
      done = true;
    }
  }
}

function abortError(): Error {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

/**
 * Run one chat-completions-shaped payload on the binding and answer in the
 * chat-completions shape. Only the fields Workers AI understands travel:
 * messages, max_tokens, temperature and stream. Vendor knobs (reasoning
 * effort, chat-template switches, stream_options, tools) are dropped here.
 * An abort before the answer starts rejects with an AbortError, like fetch.
 */
export async function workersAiFetch(
  ai: WorkersAiBinding | null,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<Response> {
  const model = typeof payload.model === 'string' ? payload.model : '';
  if (!ai) return errorResponse(401, 'the AI binding is not configured');
  if (!model) return errorResponse(400, 'no model');
  if (spentUntil > now) return errorResponse(429, SPENT, now, true);
  if (signal?.aborted) throw abortError();
  const stream = payload.stream === true;
  const inputs: Record<string, unknown> = { messages: plainMessages(payload.messages), stream };
  if (typeof payload.max_tokens === 'number') inputs.max_tokens = payload.max_tokens;
  if (typeof payload.temperature === 'number') inputs.temperature = payload.temperature;

  let result: unknown;
  try {
    const run = ai.run(model, inputs);
    result = signal
      ? await Promise.race([
          run,
          new Promise<never>((_, reject) => {
            if (signal.aborted) reject(abortError());
            signal.addEventListener('abort', () => reject(abortError()), { once: true });
          }),
        ])
      : await run;
  } catch (e) {
    if ((e as { name?: unknown })?.name === 'AbortError') throw e;
    const message = e instanceof Error ? e.message : String(e);
    const status = workersAiErrorStatus(message);
    console.log(`[ai] workers-ai model=${model} status=${status}`);
    if (status === 429 && isSpent(message)) {
      spentUntil = now + secondsToUtcMidnight(now) * 1000;
      return errorResponse(429, SPENT, now, true);
    }
    return errorResponse(status, message, now);
  }

  if (stream && result instanceof ReadableStream) {
    return new Response(toChatStream(result as ReadableStream<Uint8Array>, model), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }
  const text = resultText(result);
  const usage = usageOf(result);
  if (stream) {
    // A model that answered whole although a stream was asked for: one chunk.
    const body = `${chunk(model, text)}${usage ? sse({ object: 'chat.completion.chunk', model, choices: [], usage }) : ''}data: [DONE]\n\n`;
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  return new Response(
    JSON.stringify({
      object: 'chat.completion',
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      ...(usage ? { usage } : {}),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
