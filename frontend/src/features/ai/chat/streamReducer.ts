/**
 * v7.1 — the chat stream as a pure reducer.
 *
 * The service answers with server-sent events, one JSON object per frame:
 *
 *   { meta: { model, sources } }   who is answering, and the sources of any web search
 *   { delta: "text" }              the next piece of the reply
 *   { step: { tool, label } }      something an agentic engine just did
 *   { done: true, truncated? }     the end; `truncated` = cut short mid-reply
 *
 * Parsing used to live inline in the page's send() loop, tangled with React
 * state. Here it is two pure functions — split the byte stream into frames,
 * fold a frame into the state — so every odd case (a frame split across two
 * network chunks, a malformed frame, an unknown field from a newer server)
 * is covered by a unit test instead of by hope.
 */
import type { AgentStep, AgentTool } from './types';

export const MAX_STEPS = 12;
const STEP_LABEL_MAX = 120;
const TOOLS: readonly AgentTool[] = ['search', 'code', 'visit', 'other'];

export interface StreamState {
  /** The reply so far. */
  text: string;
  /** Sources of a web search, reported by the service (latest meta wins). */
  sources: string[];
  /** 9.1.0 — each source's title and snippet, when the server sent them. */
  sourcePreviews: Array<{ url: string; title: string; snippet: string }>;
  /** Slug of the model that is actually answering (latest meta wins). */
  model: string;
  /** Agent activity, oldest first, capped at MAX_STEPS. */
  steps: AgentStep[];
  /** The service said the reply was cut short. */
  truncated: boolean;
  done: boolean;
  /** Frames that could not be understood — skipped, counted for diagnostics. */
  malformed: number;
}

export const initialStreamState = (): StreamState => ({
  text: '',
  sources: [],
  sourcePreviews: [],
  model: '',
  steps: [],
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

/** A step as the client is willing to show it: a known tool kind and a short
 *  single-line label. The server already sanitises; this is the second lock. */
export function cleanStep(raw: unknown): AgentStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { tool?: unknown; label?: unknown };
  if (typeof r.label !== 'string') return null;
  const label = r.label.replace(/\s+/g, ' ').trim().slice(0, STEP_LABEL_MAX);
  if (!label) return null;
  const tool = TOOLS.find((t) => t === r.tool) ?? 'other';
  return { tool, label };
}

/** Append a step: newest last, an immediate repeat is dropped, capped. */
export function reduceSteps(steps: AgentStep[], raw: unknown): AgentStep[] {
  if (steps.length >= MAX_STEPS) return steps;
  const step = cleanStep(raw);
  if (!step) return steps;
  const prev = steps[steps.length - 1];
  if (prev && prev.tool === step.tool && prev.label === step.label) return steps;
  return [...steps, step];
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
    step?: unknown;
    meta?: { sources?: unknown; model?: unknown; previews?: unknown } | null;
  };
  let next = state;
  const set = (patch: Partial<StreamState>): void => {
    next = { ...next, ...patch };
  };
  if (f.truncated === true && !next.truncated) set({ truncated: true });
  if (f.meta && typeof f.meta === 'object') {
    const src = f.meta.sources;
    if (Array.isArray(src) && src.length) {
      set({ sources: src.filter((u): u is string => typeof u === 'string' && u.length > 0).slice(0, 12) });
    }
    // 9.1.0 — previews are text from arbitrary pages: every field is checked,
    // https-only, and an entry that fails is dropped rather than repaired.
    const previews = f.meta.previews;
    if (Array.isArray(previews) && previews.length) {
      const clean = previews
        .map((raw) => {
          const p = raw as { url?: unknown; title?: unknown; snippet?: unknown } | null;
          if (!p || typeof p !== 'object' || typeof p.url !== 'string') return null;
          try {
            if (new URL(p.url).protocol !== 'https:') return null;
          } catch {
            return null;
          }
          const title = typeof p.title === 'string' ? p.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
          const snippet = typeof p.snippet === 'string' ? p.snippet.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
          return title || snippet ? { url: p.url, title, snippet } : null;
        })
        .filter((p): p is { url: string; title: string; snippet: string } => p !== null)
        .slice(0, 12);
      if (clean.length) set({ sourcePreviews: clean });
    }
    if (typeof f.meta.model === 'string' && f.meta.model && f.meta.model !== next.model) set({ model: f.meta.model });
  }
  if (f.step !== undefined) {
    const steps = reduceSteps(next.steps, f.step);
    if (steps !== next.steps) set({ steps });
  }
  if (typeof f.delta === 'string' && f.delta) set({ text: next.text + f.delta });
  if (f.done === true && !next.done) set({ done: true });
  return next;
}

const SUMMARY_PHRASE: Record<AgentTool, string> = {
  search: 'searched the web',
  code: 'ran code',
  visit: 'read pages',
  other: 'used tools',
};

/** The one-line summary a finished activity list collapses to:
 *  "Searched the web · ran code · 4 steps". */
export function summariseSteps(steps: AgentStep[]): string {
  if (!steps.length) return '';
  const kinds: AgentTool[] = [];
  for (const s of steps) if (!kinds.includes(s.tool)) kinds.push(s.tool);
  const phrases = kinds.map((k) => SUMMARY_PHRASE[k]);
  const head = phrases.join(' · ');
  const line = `${head} · ${steps.length} step${steps.length === 1 ? '' : 's'}`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}
