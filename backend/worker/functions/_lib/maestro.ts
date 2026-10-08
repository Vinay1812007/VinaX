/**
 * 8.0.1 — the maestro lane's transport.
 *
 * The provider issues keys in two shapes: the classic ones (`AIza…`) that its
 * OpenAI-compatible endpoint accepts as a Bearer token, and newer ones
 * (`AQ.…`) that may only be accepted by its native generateContent API, on
 * either its public host or its cloud host. We cannot know in advance which
 * one a key belongs to, so every call goes through maestroFetch(), which:
 *
 *   1. tries the modes in the order that suits the key's shape (the mode that
 *      last worked in this isolate goes first);
 *   2. moves to the next mode only when the answer says "this key or this
 *      endpoint is wrong" (401, 403, 404, or a 400 that names the API key) —
 *      a 429, a 5xx or a real 400 is the provider's answer and is returned;
 *   3. translates the chat-completions payload into the native request and
 *      the native answer back into a chat-completions body, so every caller
 *      (chat(), the AI Lab bench, health, the engine test) reads one shape.
 *
 * `stream: true` callers get the whole answer as one server-sent-events
 * chunk plus [DONE]: the bench only needs the text, and a native streaming
 * adapter is not worth its complexity for one lane.
 */

export type MaestroMode = 'openai' | 'native' | 'cloud';

const OPENAI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const nativeUrl = (model: string, stream: boolean): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
const cloudUrl = (model: string, key: string, stream: boolean): string =>
  `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?'}key=${encodeURIComponent(key)}`;

let learned: MaestroMode | null = null;

/** Which modes to try, best guess first. */
export function maestroModes(key: string, remembered: MaestroMode | null = learned): MaestroMode[] {
  const order: MaestroMode[] = key.startsWith('AQ.') ? ['native', 'cloud', 'openai'] : ['openai', 'native', 'cloud'];
  return remembered ? [remembered, ...order.filter((m) => m !== remembered)] : order;
}

/** The mode that answered last in this isolate (for the owner console and tests). */
export function maestroLearnedMode(): MaestroMode | null {
  return learned;
}
/** Test hook. */
export function resetMaestroMode(): void {
  learned = null;
}

interface ChatPayload {
  model?: unknown;
  messages?: Array<{ role?: unknown; content?: unknown }>;
  temperature?: unknown;
  max_tokens?: unknown;
  response_format?: { type?: unknown } | null;
  reasoning_effort?: unknown;
  stream?: unknown;
  /** 10.3 — run Gemini's code execution tool (the provider's own sandbox,
   * never the Worker). Native endpoints only; never a web tool. */
  code_execution?: unknown;
  /** 11.0 — Gemini's search grounding (the provider's own web search). Native
   * endpoints only. Code execution wins when both are asked for. */
  web_search?: unknown;
}

/** 10.3 — executed code and its output as fenced Markdown, so every client
 * that renders a reply renders them too. Exported for tests and for the Groq
 * code interpreter, which reports the same two things in its own fields. */
export function codeBlock(code: string, language = 'python'): string {
  const lang = language.toLowerCase().replace(/[^a-z0-9+#-]/g, '') || 'python';
  return `\n\n\`\`\`${lang}\n${code.replace(/\s+$/, '')}\n\`\`\`\n\n`;
}
export function outputBlock(output: string): string {
  return `**Output**\n\n\`\`\`\n${output.replace(/\s+$/, '') || '(no output)'}\n\`\`\`\n\n`;
}

interface NativePart {
  text?: unknown;
  thought?: unknown;
  executableCode?: { language?: unknown; code?: unknown };
  codeExecutionResult?: { outcome?: unknown; output?: unknown };
}

/** The reply text of one native part: text as is, executed code and its
 * result as fenced blocks (10.3), thought parts dropped. */
export function partText(p: NativePart): string {
  if (p.thought === true) return '';
  if (typeof p.text === 'string') return p.text;
  if (p.executableCode && typeof p.executableCode.code === 'string') return codeBlock(p.executableCode.code, typeof p.executableCode.language === 'string' ? p.executableCode.language : 'python');
  if (p.codeExecutionResult) return outputBlock(typeof p.codeExecutionResult.output === 'string' ? p.codeExecutionResult.output : '');
  return '';
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('');
  return '';
};

const THINKING_BUDGET: Record<string, number> = { low: 1024, medium: 4096, high: 12288 };

/** 10.3 — the native parts for one chat message. Text stays text; an attached
 * image (`image_url` with a base64 data URL, the only kind VinaX AI sends)
 * becomes inline data, so a Gemini model picked from the catalogue sees the
 * picture on the native endpoints too instead of silently answering blind. */
export function nativeParts(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return [{ text: textOf(content) || ' ' }];
  const parts: Array<Record<string, unknown>> = [];
  for (const p of content as Array<{ type?: unknown; text?: unknown; image_url?: { url?: unknown } }>) {
    if (!p || typeof p !== 'object') continue;
    if (typeof p.text === 'string' && p.text) parts.push({ text: p.text });
    const url = typeof p.image_url?.url === 'string' ? p.image_url.url : '';
    const m = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(url);
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  return parts.length ? parts : [{ text: ' ' }];
}

/** The native generateContent body for a chat-completions payload. */
export function toNativeRequest(payload: ChatPayload, withThinking = true): Record<string, unknown> {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const system = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).filter(Boolean).join('\n\n');
  const contents = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: nativeParts(m.content) }));
  const generationConfig: Record<string, unknown> = {};
  if (typeof payload.temperature === 'number') generationConfig.temperature = payload.temperature;
  if (typeof payload.max_tokens === 'number') generationConfig.maxOutputTokens = payload.max_tokens;
  if (payload.response_format && payload.response_format.type === 'json_object') generationConfig.responseMimeType = 'application/json';
  const effort = typeof payload.reasoning_effort === 'string' ? payload.reasoning_effort : 'low';
  if (withThinking) {
    // A tiny answer (a health ping) must not spend its whole ceiling thinking: no budget then.
    const budget = THINKING_BUDGET[effort] ?? 1024;
    const cap = typeof payload.max_tokens === 'number' ? payload.max_tokens : Infinity;
    generationConfig.thinkingConfig = { thinkingBudget: cap < budget * 1.5 ? 0 : budget };
  }
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: contents.length ? contents : [{ role: 'user', parts: [{ text: ' ' }] }],
    generationConfig,
    // 10.3 — the code execution tool, when asked. 11.0 — or the provider's own
    // search grounding (`googleSearch`, lowerCamelCase like `codeExecution`;
    // the REST JSON accepts both spellings). Grounding and code execution are
    // not combined: code wins when both are asked for. Nothing else is ever
    // put in `tools` (no URL context, no third-party search).
    ...(payload.code_execution === true ? { tools: [{ codeExecution: {} }] } : payload.web_search === true ? { tools: [{ googleSearch: {} }] } : {}),
  };
}

interface NativeAnswer {
  candidates?: Array<{ content?: { parts?: NativePart[] }; finishReason?: unknown; groundingMetadata?: unknown }>;
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; thoughtsTokenCount?: unknown };
}

/** 11.0 — what a grounded answer drew on, as VinaX forwards it to the client:
 * the pages (de-duplicated by url, http(s) only, at most 8, titles clipped),
 * the queries the model ran, and the provider's search-suggestion snippet
 * (`searchEntryPoint.renderedContent`, HTML the client shows in a sandbox —
 * showing it is a condition of the free grounding service).
 * 11.2 — and which parts of the answer each page backs (`groundingSupports`):
 * `supports[k].text` is the END of the answer's segment (its last 300
 * characters — what the client needs to find where the sentence stops), and
 * `supports[k].sources` are indexes into `items` (remapped: items are
 * de-duplicated, so a chunk index is not an item index). */
export interface GroundingSupport {
  text: string;
  sources: number[];
}
export interface GroundingSources {
  items: Array<{ url: string; title: string }>;
  queries: string[];
  entry: string | null;
  supports: GroundingSupport[];
}
const MAX_SUPPORTS = 40;
const MAX_SUPPORT_TEXT = 300;
export function groundingSources(raw: unknown): GroundingSources | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as { groundingChunks?: unknown; groundingSupports?: unknown; webSearchQueries?: unknown; searchEntryPoint?: { renderedContent?: unknown } | null };
  const items: Array<{ url: string; title: string }> = [];
  const seen = new Map<string, number>();
  // chunk index -> item index (a repeated page maps to its first item).
  const itemOf = new Map<number, number>();
  const chunks = Array.isArray(g.groundingChunks) ? g.groundingChunks : [];
  chunks.forEach((c, ci) => {
    const web = (c as { web?: { uri?: unknown; title?: unknown } } | null)?.web;
    const url = typeof web?.uri === 'string' ? web.uri.trim() : '';
    if (!/^https?:\/\/\S+$/i.test(url)) return;
    const known = seen.get(url);
    if (known !== undefined) {
      itemOf.set(ci, known);
      return;
    }
    if (items.length >= 8) return;
    seen.set(url, items.length);
    itemOf.set(ci, items.length);
    items.push({ url, title: (typeof web?.title === 'string' ? web.title : '').replace(/\s+/g, ' ').trim().slice(0, 120) });
  });
  const supports: GroundingSupport[] = [];
  for (const sp of Array.isArray(g.groundingSupports) ? g.groundingSupports : []) {
    if (supports.length >= MAX_SUPPORTS) break;
    const s = sp as { segment?: { text?: unknown } | null; groundingChunkIndices?: unknown } | null;
    const text = typeof s?.segment?.text === 'string' ? s.segment.text.trim() : '';
    if (!text) continue;
    const sources: number[] = [];
    for (const ci of Array.isArray(s?.groundingChunkIndices) ? s.groundingChunkIndices : []) {
      const it = typeof ci === 'number' ? itemOf.get(ci) : undefined;
      if (it !== undefined && !sources.includes(it)) sources.push(it);
    }
    if (sources.length) supports.push({ text: text.slice(-MAX_SUPPORT_TEXT).trimStart(), sources: sources.slice(0, 8) });
  }
  const queries = (Array.isArray(g.webSearchQueries) ? g.webSearchQueries : [])
    .filter((q): q is string => typeof q === 'string' && !!q.trim())
    .map((q) => q.trim().slice(0, 200))
    .slice(0, 8);
  const rendered = g.searchEntryPoint?.renderedContent;
  const entry = typeof rendered === 'string' && rendered.trim() ? rendered.slice(0, 20_000) : null;
  return items.length || queries.length || entry ? { items, queries, entry, supports } : null;
}

/** A native answer as a chat-completions body (thought parts dropped). */
export function fromNativeAnswer(answer: NativeAnswer, model: string): Record<string, unknown> {
  const cand = answer.candidates?.[0];
  const content = (cand?.content?.parts ?? []).map(partText).join('');
  const u = answer.usageMetadata;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const finish = typeof cand?.finishReason === 'string' ? cand.finishReason.toLowerCase() : 'stop';
  const grounding = groundingSources(cand?.groundingMetadata);
  return {
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish === 'max_tokens' ? 'length' : finish }],
    ...(u ? { usage: { prompt_tokens: num(u.promptTokenCount), completion_tokens: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount) } } : {}),
    ...(grounding ? { grounding } : {}),
  };
}

/** True when an error answer means "wrong key type or wrong endpoint for it", so the next mode may work. */
export function isWrongDoor(status: number, body: string): boolean {
  if (status === 401 || status === 403 || status === 404) return true;
  return status === 400 && /api[ _-]?key|API_KEY_INVALID|UNAUTHENTICATED|credential/i.test(body);
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function asSse(body: Record<string, unknown>): Response {
  const choices = body.choices as Array<{ message?: { content?: string } }> | undefined;
  const text = choices?.[0]?.message?.content ?? '';
  const grounding = body.grounding ? `data: ${JSON.stringify({ choices: [], grounding: body.grounding })}\n\n` : '';
  const chunks = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n${grounding}${body.usage ? `data: ${JSON.stringify({ choices: [], usage: body.usage })}\n\n` : ''}data: [DONE]\n\n`;
  return new Response(chunks, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/**
 * 8.1.0 — the native streaming call (`streamGenerateContent?alt=sse`),
 * rewritten on the fly into OpenAI-shaped SSE (`choices[0].delta.content`),
 * with thought parts dropped and usage on the last chunk. So the chat route streams
 * this lane exactly like every other, token by token.
 */
function nativeStreamToSse(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = '';
  let usage: Record<string, unknown> | null = null;
  // 11.0 — grounding metadata (usually on the last chunk); the fullest wins
  // (11.2: more pages, then more supported segments).
  let grounding: GroundingSources | null = null;
  const frame = (obj: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
  const handle = (line: string, controller: TransformStreamDefaultController<Uint8Array>): void => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data) return;
    let j: NativeAnswer;
    try {
      j = JSON.parse(data) as NativeAnswer;
    } catch {
      return;
    }
    const parts = j.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map(partText).join('');
    if (text) controller.enqueue(frame({ choices: [{ delta: { content: text } }] }));
    const g = groundingSources(j.candidates?.[0]?.groundingMetadata);
    if (g && (!grounding || g.items.length > grounding.items.length || (g.items.length === grounding.items.length && g.supports.length >= grounding.supports.length))) grounding = g;
    const u = j.usageMetadata;
    if (u && typeof u.promptTokenCount === 'number') {
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      usage = { prompt_tokens: num(u.promptTokenCount), completion_tokens: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount) };
    }
  };
  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          handle(line, controller);
        }
      },
      flush(controller) {
        if (buf.trim()) handle(buf.trim(), controller);
        // One extra OpenAI-shaped frame with no delta: the chat route turns it
        // into its own `sources` event.
        if (grounding) controller.enqueue(frame({ choices: [], grounding }));
        if (usage) controller.enqueue(frame({ choices: [], usage }));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      },
    }),
  );
}

async function tryMode(mode: MaestroMode, key: string, model: string, payload: ChatPayload, signal?: AbortSignal): Promise<Response> {
  const stream = payload.stream === true;
  if (mode === 'openai') {
    // The OpenAI-compatible endpoint streams OpenAI-shaped SSE itself.
    const { code_execution: _code, web_search: _web, ...plain } = payload;
    void _code;
    void _web;
    return fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...plain, model, stream }),
      signal,
    });
  }
  const url = mode === 'native' ? nativeUrl(model, stream) : cloudUrl(model, key, stream);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (mode === 'native') headers['x-goog-api-key'] = key;
  const send = (withThinking: boolean): Promise<Response> => fetch(url, { method: 'POST', headers, body: JSON.stringify(toNativeRequest(payload, withThinking)), signal });
  let res = await send(true);
  // Some models refuse a thinking budget (a 400 that names it): ask again without one.
  if (res.status === 400) {
    const body = await res.clone().text().catch(() => '');
    if (/thinking/i.test(body)) res = await send(false);
  }
  if (!res.ok) return res;
  if (stream) {
    if (!res.body) return json({ error: 'empty_stream' }, 502);
    return new Response(nativeStreamToSse(res.body), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  const answer = (await res.json().catch(() => null)) as NativeAnswer | null;
  return json(fromNativeAnswer(answer ?? {}, model));
}

/**
 * 8.0.2 — the provider retires models (live, 2026-09-26: "This model
 * models/gemini-2.5-flash is no longer available to new users. Please update
 * your code to use models/gemini-3.8-flash"). A 404 that talks about the
 * MODEL is not a wrong door: the key and endpoint are right, the name is old.
 * The replacement is the model the error names, else the newest general
 * "flash" model this key can list; it is remembered per isolate so later
 * calls go straight to it.
 */
const modelSwap = new Map<string, string>();
/** Test hook. */
export function resetMaestroModels(): void {
  modelSwap.clear();
}
/** The model a pinned name currently resolves to in this isolate. */
export function maestroModelFor(model: string): string {
  return modelSwap.get(model) ?? model;
}

/** True when an error answer says the requested model is unavailable (retired, unknown or not for this key). */
export function isModelGone(status: number, body: string): boolean {
  if (status !== 404 && status !== 400) return false;
  if (/api[ _-]?key|API_KEY_INVALID|UNAUTHENTICATED/i.test(body)) return false;
  return /model/i.test(body) && /(not found|no longer available|not supported|is not available|does not exist|update your code|deprecated|retired)/i.test(body);
}

/** The model an error message tells us to use instead ("…use models/gemini-3.8-flash…"). */
export function suggestedModel(body: string): string | null {
  const m = body.match(/\buse\s+(?:the\s+)?(?:models\/)?(gemini-[\w.-]*[\w])/i);
  return m ? m[1] : null;
}

/**
 * The best general model from a list of names: gemini, "flash", not a lite,
 * image, audio, speech, live, embedding or tuning variant; stable before
 * preview/experimental; highest version first.
 */
export function pickModel(names: string[]): string | null {
  const clean = names.map((n) => n.replace(/^models\//, '')).filter((n) => /^gemini-/i.test(n) && /flash/i.test(n) && !/lite|image|audio|tts|speech|live|embed|tuning|thinking-exp|robotics|computer/i.test(n));
  const version = (n: string): number => {
    const v = n.match(/^gemini-(\d+)(?:\.(\d+))?/i);
    return v ? Number(v[1]) * 100 + Number(v[2] ?? 0) : 0;
  };
  const unstable = (n: string): number => (/preview|exp|latest/i.test(n) ? 1 : 0);
  clean.sort((a, b) => unstable(a) - unstable(b) || version(b) - version(a) || a.length - b.length);
  return clean[0] ?? null;
}

/** The models this key can use, from the provider's own list (native, then the OpenAI-compatible list). */
export async function listMaestroModels(key: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key }, signal });
    if (res.ok) {
      const j = (await res.json()) as { models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }> };
      const names = (j.models ?? [])
        .filter((m) => !Array.isArray(m.supportedGenerationMethods) || (m.supportedGenerationMethods as unknown[]).includes('generateContent'))
        .map((m) => (typeof m.name === 'string' ? m.name : ''))
        .filter(Boolean);
      if (names.length) return names;
    }
  } catch {
    /* try the other list */
  }
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', { headers: { authorization: `Bearer ${key}` }, signal });
    if (res.ok) {
      const j = (await res.json()) as { data?: Array<{ id?: unknown }> };
      return (j.data ?? []).map((m) => (typeof m.id === 'string' ? m.id : '')).filter(Boolean);
    }
  } catch {
    /* no list */
  }
  return [];
}

function finish(res: Response, payload: ChatPayload, mode: MaestroMode): Promise<Response> | Response {
  learned = mode;
  // A streaming answer is already SSE (native: rewritten; OpenAI-compatible: as served).
  if (payload.stream === true) {
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/event-stream')) return res;
    return res.json().catch(() => ({})).then((body) => asSse(body as Record<string, unknown>));
  }
  return res;
}

/**
 * Send one chat-completions payload to the maestro provider, whatever the
 * key's shape. Resolves with a Response in chat-completions form (or its SSE
 * form when `payload.stream` is true). Network errors and aborts reject, as
 * fetch() does, so callers' timeout handling is unchanged.
 *
 * 10.3 — `swap: false` for a listener's exact catalogue pick: a gone model
 * answers with its own error (and the caller's ladder takes over) instead of
 * being replaced by another model the reply would then misname.
 */
export async function maestroFetch(rawKey: string, requested: string, payload: ChatPayload, signal?: AbortSignal, swap = true): Promise<Response> {
  // A pasted secret often carries a trailing newline or spaces.
  const key = rawKey.trim();
  const model = swap ? maestroModelFor(requested) : requested;
  // 10.3 — code execution is a native-API tool: the OpenAI-compatible door is
  // skipped for it. 11.0 — so is search grounding.
  const modes = payload.code_execution === true || payload.web_search === true ? maestroModes(key).filter((m) => m !== 'openai') : maestroModes(key);
  let last: Response | null = null;
  for (let i = 0; i < modes.length; i += 1) {
    const mode = modes[i];
    const res = await tryMode(mode, key, model, payload, signal);
    if (res.ok) return finish(res, payload, mode);
    const body = await res.clone().text().catch(() => '');
    last = res;
    if (isModelGone(res.status, body)) {
      if (!swap) return res;
      // The door is right, the name is old: find the current model and ask again on this mode.
      const replacement = suggestedModel(body) ?? pickModel(await listMaestroModels(key, signal));
      console.log(`[ai] maestro mode=${mode} model=${model} gone → ${replacement ?? 'no replacement found'}`);
      if (replacement && replacement !== model) {
        const retry = await tryMode(mode, key, replacement, payload, signal);
        if (retry.ok) {
          modelSwap.set(requested, replacement);
          return finish(retry, payload, mode);
        }
        return retry;
      }
      return res;
    }
    const more = i < modes.length - 1;
    console.log(`[ai] maestro mode=${mode} status=${res.status}${more && isWrongDoor(res.status, body) ? ' → next mode' : ''}`);
    if (!isWrongDoor(res.status, body)) return res;
  }
  return last ?? json({ error: 'no_mode' }, 502);
}

/**
 * 10.3 — one native generateContent call for the media routes (speech,
 * transcription): the public host with the key in a header, then the cloud
 * host when the answer says the key belongs there (the same wrong-door rule
 * as maestroFetch). The body is a native request, sent as given; the answer
 * is the provider's own JSON. Network errors reject, as fetch() does.
 */
export async function geminiGenerate(rawKey: string, model: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const key = rawKey.trim();
  const init = (headers: Record<string, string>): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  const res = await fetch(nativeUrl(model, false), init({ 'x-goog-api-key': key }));
  if (res.ok) return res;
  const text = await res.clone().text().catch(() => '');
  if (!isWrongDoor(res.status, text) || isModelGone(res.status, text)) return res;
  void res.body?.cancel().catch(() => undefined);
  return fetch(cloudUrl(model, key, false), init({}));
}
