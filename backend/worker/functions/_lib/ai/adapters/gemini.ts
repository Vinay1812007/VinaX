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
import type { Adapter, AiEnv, ChatRequest, GroundingSupport, ProviderEvent, Source } from '../types';

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

export function geminiBody(req: ChatRequest, grounding = req.webSearch && req.model.flags.grounding): Record<string, unknown> {
  const { system, messages } = wireMessages(req.model, req.system, req.messages);
  const merged = {
    ...(req.model.params ?? {}),
    ...(req.reasoning === 'high' ? req.model.highParams ?? {} : {}),
    ...(req.reasoning === 'off' ? req.model.offParams ?? {} : {}),
  } as { thinkingConfig?: Record<string, unknown> };
  const generationConfig: Record<string, unknown> = { maxOutputTokens: Math.min(req.maxOutputTokens, req.model.maxOutput) };
  if (req.temperature != null) generationConfig.temperature = req.temperature;
  if (merged.thinkingConfig) generationConfig.thinkingConfig = merged.thinkingConfig;
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

export const gemini: Adapter = {
  async *stream(env: AiEnv, req: ChatRequest): AsyncGenerator<ProviderEvent> {
    const key = env.GEMINI_API_KEY?.trim();
    if (!key) throw new ProviderError('not_configured');
    const call = (grounding: boolean) => fetch(`${BASE}/${encodeURIComponent(geminiModelId(req.model.upstream))}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(geminiBody(req, grounding)),
      signal: req.signal,
    });
    const grounding = req.webSearch && req.model.flags.grounding;
    let res = await call(grounding);
    if (!res.ok && grounding && (res.status === 400 || res.status === 429)) {
      // Grounding itself refused (its own quota, or not offered for this key):
      // ask once more without it rather than failing the model.
      const body = await errorText(res);
      if (/ground|search/i.test(body)) res = await call(false);
      else throw classifyHttp(res.status, res.headers, body);
    }
    if (!res.ok) throw classifyHttp(res.status, res.headers, await errorText(res));
    let grounded: Extract<ProviderEvent, { type: 'sources' }> | null = null;
    const split = new ThinkSplitter();
    let reason: 'stop' | 'length' | 'content_filter' = 'stop';
    let usage: { input: number; output: number } | null = null;
    for await (const data of sseData(res.body, req.signal)) {
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
  },
};
