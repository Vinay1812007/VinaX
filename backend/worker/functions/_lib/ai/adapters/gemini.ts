/**
 * VinaX AI — the Gemini adapter, on the native API
 * (`models/{id}:streamGenerateContent?alt=sse`). The key travels in the
 * `x-goog-api-key` header, never in the URL, so it cannot end up in a log.
 *
 * Thought parts (`thought: true`, asked for with
 * `thinkingConfig.includeThoughts`) become `thinking` events; everything else
 * is answer text. Grounding (phase 3) and files (phase 4) plug in here.
 */
import { classifyHttp, errorText, ProviderError } from '../errors';
import { parseJson, sseData } from '../sse';
import { ThinkSplitter } from '../think';
import { wireMessages } from '../wire';
import type { AiEnv, ChatRequest, GroundingSupport, ProviderEvent, Source, WireAdapter } from '../types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface Chunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
    groundingMetadata?: GroundingMetadata;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { code?: number; message?: string };
}

interface GroundingMetadata {
  webSearchQueries?: string[];
  searchEntryPoint?: { renderedContent?: string };
  groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
  groundingSupports?: Array<{ segment?: { endIndex?: number; text?: string }; groundingChunkIndices?: number[] }>;
}

/** Google's grounding data as numbered sources (1-based, in chunk order) and the text each supports. */
export function groundingEvent(g: GroundingMetadata): Extract<ProviderEvent, { type: 'sources' }> | null {
  const chunks = (g.groundingChunks ?? []).filter((c) => c.web?.uri);
  if (!chunks.length) return null;
  const items: Source[] = chunks.slice(0, 20).map((c, i) => {
    const title = (c.web?.title ?? '').trim();
    // The uri is Google's redirect; the title is the site's domain.
    return { n: i + 1, url: c.web!.uri!, title: title || 'Source', site: title.replace(/^www\./, '') || 'source' };
  });
  const supports: GroundingSupport[] = (g.groundingSupports ?? [])
    .map((s) => ({
      text: s.segment?.text ?? '',
      endIndex: s.segment?.endIndex ?? -1,
      ns: (s.groundingChunkIndices ?? []).filter((i) => i >= 0 && i < items.length).map((i) => i + 1),
    }))
    .filter((s) => s.ns.length > 0 && (s.text || s.endIndex >= 0));
  return {
    type: 'sources',
    items,
    queries: (g.webSearchQueries ?? []).slice(0, 5),
    ...(g.searchEntryPoint?.renderedContent ? { entryPointHtml: g.searchEntryPoint.renderedContent.slice(0, 50_000) } : {}),
    supports,
  };
}

/** Registry ids carry no `models/` prefix; strip it if one slips in. */
export const geminiModelId = (upstream: string): string => upstream.replace(/^models\//, '');

/**
 * `plainThinking`: the thinking switches without a level or budget (only
 * `includeThoughts`), for a model that refused them.
 */
export function geminiBody(req: ChatRequest, grounding = req.webSearch && req.model.flags.grounding, plainThinking = false): Record<string, unknown> {
  const { system, messages } = wireMessages(req.model, req.system, req.messages);
  const merged = {
    ...(req.model.params ?? {}),
    ...(req.reasoning === 'high' ? req.model.highParams ?? {} : {}),
    ...(req.reasoning === 'off' ? req.model.offParams ?? {} : {}),
  } as { thinkingConfig?: Record<string, unknown> };
  const generationConfig: Record<string, unknown> = { maxOutputTokens: Math.min(req.maxOutputTokens, req.model.maxOutput) };
  if (req.temperature != null) generationConfig.temperature = req.temperature;
  if (merged.thinkingConfig) {
    const tc = merged.thinkingConfig;
    if (!plainThinking) generationConfig.thinkingConfig = tc;
    else if (tc.includeThoughts === true) generationConfig.thinkingConfig = { includeThoughts: true };
  }
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: messages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(msg.files ?? []).map((f) => ({ file_data: { mime_type: f.mime, file_uri: f.uri } })),
        ...(msg.images ?? []).map((im) => ({ inline_data: { mime_type: im.mime, data: im.data } })),
        { text: msg.text },
      ],
    })),
    generationConfig,
    ...(grounding ? { tools: [{ googleSearch: {} }] } : {}),
  };
}

const finish = (r: string | undefined): 'stop' | 'length' | 'content_filter' | null => {
  if (!r || r === 'FINISH_REASON_UNSPECIFIED') return null;
  if (r === 'MAX_TOKENS') return 'length';
  if (r === 'STOP') return 'stop';
  if (/SAFETY|PROHIBITED|BLOCKLIST|RECITATION|SPII/.test(r)) return 'content_filter';
  return 'stop';
};

/** The output room Gemini models take everywhere (the registry's usual `maxOutput`). */
export const OUTPUT_FALLBACK = 32_768;

async function openGemini(env: AiEnv, req: ChatRequest): Promise<ReadableStream<Uint8Array>> {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) throw new ProviderError('not_configured');
  const call = (grounding: boolean, plainThinking = false, output?: number) => fetch(`${BASE}/${encodeURIComponent(geminiModelId(req.model.upstream))}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(geminiBody(output ? { ...req, maxOutputTokens: output } : req, grounding, plainThinking)),
    signal: req.signal,
  });
  const grounding = req.webSearch && req.model.flags.grounding;
  let res = await call(grounding);
  if (!res.ok && (res.status === 400 || (grounding && res.status === 429))) {
    const body = await errorText(res);
    // Grounding itself refused (its own quota, or not offered for this key):
    // ask once more without it rather than failing the model.
    if (grounding && /ground|search/i.test(body)) res = await call(false);
    // A thinking level or budget this model does not take: once more with the model's own default.
    else if (res.status === 400 && /thinking/i.test(body)) res = await call(grounding, true);
    // Maximum thinking asked for more output room than this model takes: once more with its usual room.
    else if (res.status === 400 && req.maxOutputTokens > OUTPUT_FALLBACK && /max_?output_?tokens|output token/i.test(body)) res = await call(grounding, false, OUTPUT_FALLBACK);
    else throw classifyHttp(res.status, res.headers, body);
  }
  if (!res.ok) throw classifyHttp(res.status, res.headers, await errorText(res));
  if (!res.body) throw new ProviderError('empty');
  return res.body;
}

/** Reads Gemini's SSE body (alt=sse) into events. */
export async function* parseGeminiStream(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal): AsyncGenerator<ProviderEvent> {
  let grounded: Extract<ProviderEvent, { type: 'sources' }> | null = null;
  const split = new ThinkSplitter();
  let reason: 'stop' | 'length' | 'content_filter' = 'stop';
  let usage: { input: number; output: number } | null = null;
  for await (const data of sseData(body, signal)) {
    const j = parseJson<Chunk>(data);
    if (!j) continue;
    if (j.error) throw classifyHttp(Number(j.error.code) || 502, null, String(j.error.message ?? ''));
    if (j.promptFeedback?.blockReason) reason = 'content_filter';
    const cand = j.candidates?.[0];
    for (const part of cand?.content?.parts ?? []) {
      if (!part.text) continue;
      if (part.thought === true) yield* split.reasoning(part.text);
      else yield* split.push(part.text);
    }
    const f = finish(cand?.finishReason);
    if (f) reason = f;
    if (cand?.groundingMetadata) grounded = groundingEvent(cand.groundingMetadata) ?? grounded;
    const u = j.usageMetadata;
    if (u) usage = { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
  }
  yield* split.end();
  if (!split.sawText) {
    // A blocked prompt is an answer of its own kind, not a broken model.
    if (reason === 'content_filter') {
      yield { type: 'end', reason };
      return;
    }
    throw new ProviderError('empty');
  }
  if (grounded) yield grounded;
  if (usage) yield { type: 'usage', ...usage };
  yield { type: 'end', reason };
}

export const gemini: WireAdapter = {
  wire: 'gemini',
  open: openGemini,
  parse: parseGeminiStream,
  async *stream(env: AiEnv, req: ChatRequest): AsyncGenerator<ProviderEvent> {
    yield* parseGeminiStream(await openGemini(env, req), req.signal);
  },
};
