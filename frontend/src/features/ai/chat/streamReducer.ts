/**
 * v7.1 — the chat stream as a pure reducer.
 *
 * The service answers with server-sent events, one JSON object per frame:
 *
 *   { meta: { model, modelId,      who is answering: the model's original
 *             provider, mode,      name, its slug and its provider (10.3);
 *             tools? } }           sent again if a failover changes engine.
 *                                  `tools` (10.3): tools that were on for it
 *   { delta: "text" }              the next piece of the reply
 *   { sources: { items, queries,   11.0: the pages a web-grounded reply drew
 *                entry } }          on (Gemini 2.5 Flash only); old clients ignore it
 *   { done: true, truncated? }     the end; `truncated` = cut short mid-reply
 *
 * Parsing used to live inline in the page's send() loop, tangled with React
 * state. Here it is two pure functions — split the byte stream into frames,
 * fold a frame into the state — so every odd case (a frame split across two
 * network chunks, a malformed frame, an unknown field from a newer server)
 * is covered by a unit test instead of by hope. Fields this build does not
 * know (an older server's extra meta, any other frame kind) are ignored.
 */

import type { MsgSources } from './types';

export interface StreamState {
  /** The reply so far. */
  text: string;
  /** The model that is actually answering (latest meta wins). 10.3: its
   *  original name; an older server sent an opaque label or a slug. */
  model: string;
  /** 10.3 — its slug and provider id ('' when the server did not say). */
  modelId: string;
  provider: string;
  /** 10.3 — tools that were on for the answering model (`['code_execution']`). */
  tools: string[];
  /** 11.0 — the pages a grounded reply drew on (null until the event arrives). */
  sources: MsgSources | null;
  /** The service said the reply was cut short. */
  truncated: boolean;
  done: boolean;
  /** Frames that could not be understood — skipped, counted for diagnostics. */
  malformed: number;
}

export const initialStreamState = (): StreamState => ({
  text: '',
  model: '',
  modelId: '',
  provider: '',
  tools: [],
  sources: null,
  truncated: false,
  done: false,
  malformed: 0,
});

/** Split what has arrived so far into complete frames plus the unfinished
 *  tail to carry into the next chunk. Frames are separated by a blank line;
 *  only `data:` frames carry a payload (comments and keep-alives are dropped).
 *  A payload that is not JSON comes back as `undefined`, which the reducer
 *  counts as malformed. */
export function splitFrames(buffer: string): { frames: unknown[]; rest: string } {
  const frames: unknown[] = [];
  let buf = buffer.replace(/\r\n/g, '\n');
  let sep = buf.indexOf('\n\n');
  while (sep >= 0) {
    const chunk = buf.slice(0, sep).trim();
    buf = buf.slice(sep + 2);
    sep = buf.indexOf('\n\n');
    if (!chunk.startsWith('data:')) continue;
    const payload = chunk.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      frames.push(JSON.parse(payload) as unknown);
    } catch {
      frames.push(undefined);
    }
  }
  return { frames, rest: buf };
}

/** 11.0 — a `sources` payload, validated: http(s) urls only, de-duplicated, at
 *  most 8, titles clipped; queries as strings; the snippet as a string or null.
 *  Null when nothing usable is in it. Exported for tests. */
export function readSources(raw: unknown): MsgSources | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { items?: unknown; queries?: unknown; entry?: unknown };
  const items: MsgSources['items'] = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const url = typeof (it as { url?: unknown })?.url === 'string' ? (it as { url: string }).url.trim() : '';
    if (!/^https?:\/\/\S+$/i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const t = (it as { title?: unknown }).title;
    items.push({ url, title: typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, 120) : '' });
    if (items.length >= 8) break;
  }
  const queries = (Array.isArray(r.queries) ? r.queries : []).filter((q): q is string => typeof q === 'string' && !!q.trim()).slice(0, 8);
  const entry = typeof r.entry === 'string' && r.entry.trim() ? r.entry : null;
  return items.length || queries.length || entry ? { items, queries, entry } : null;
}

/** Fold one frame into the state. Never throws; returns the SAME object when
 *  the frame changed nothing, so callers can skip a re-render. */
export function reduceFrame(state: StreamState, frame: unknown): StreamState {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
    return { ...state, malformed: state.malformed + 1 };
  }
  const f = frame as {
    delta?: unknown;
    done?: unknown;
    truncated?: unknown;
    meta?: { model?: unknown; modelId?: unknown; provider?: unknown; tools?: unknown } | null;
    sources?: unknown;
  };
  let next = state;
  const set = (patch: Partial<StreamState>): void => {
    next = { ...next, ...patch };
  };
  if (f.truncated === true && !next.truncated) set({ truncated: true });
  if (f.meta && typeof f.meta === 'object') {
    if (typeof f.meta.model === 'string' && f.meta.model && f.meta.model !== next.model) set({ model: f.meta.model });
    // A failover hop re-sends meta: the provider and slug follow the engine,
    // and a hop that leaves them out clears them rather than keeping stale ones.
    if (typeof f.meta.model === 'string' && f.meta.model) {
      const modelId = typeof f.meta.modelId === 'string' ? f.meta.modelId : '';
      const provider = typeof f.meta.provider === 'string' ? f.meta.provider : '';
      if (modelId !== next.modelId || provider !== next.provider) set({ modelId, provider });
      // 10.3 — the tools follow the engine as well.
      const tools = Array.isArray(f.meta.tools) ? f.meta.tools.filter((t): t is string => typeof t === 'string' && !!t).slice(0, 8) : [];
      if (tools.join(',') !== next.tools.join(',')) set({ tools });
    }
  }
  if (typeof f.delta === 'string' && f.delta) set({ text: next.text + f.delta });
  if (f.sources !== undefined) {
    const sources = readSources(f.sources);
    if (sources) set({ sources });
  }
  if (f.done === true && !next.done) set({ done: true });
  return next;
}
