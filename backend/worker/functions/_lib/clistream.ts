/**
 * Normalizing stream parser for the VinaX CLI agent endpoint.
 *
 * Engines differ. Some emit native OpenAI-style `tool_calls` deltas, some
 * emit only prose, some open a reply with a bare or `<think>`-wrapped
 * reasoning block. The CLI must never see any of that: it receives VinaX
 * events (`assistant_delta`, `tool_call`) and nothing provider-shaped.
 *
 * So this module does three jobs, incrementally, as bytes arrive:
 *
 *  1. Gates chain-of-thought. A `<think>…</think>` opener is swallowed whole;
 *     `reasoning_content` deltas are dropped at the call site. Internal
 *     reasoning never reaches a user's terminal.
 *  2. Extracts the server-controlled tool syntax (see ./cliprompt.ts) without
 *     ever letting a partially-received marker leak into displayed text — the
 *     reason this is a state machine rather than a regex over the finished
 *     reply. A tool block is not shown to the user; it becomes an event.
 *  3. Leaves everything else as clean assistant text.
 *
 * Pure and synchronous: fully unit-testable with hand-fragmented chunks,
 * which matters because SSE splits wherever the network feels like it.
 */
import { TOOL_CLOSE, TOOL_OPEN } from './cliprompt';

export interface ParsedChunk {
  /** Assistant text safe to forward to the client right now. */
  text: string;
  /** Raw tool-call JSON strings completed by this chunk. */
  calls: string[];
}

/** Length of the longest suffix of `s` that is a proper prefix of `marker`. */
function heldBack(s: string, marker: string): number {
  const max = Math.min(s.length, marker.length - 1);
  for (let n = max; n > 0; n -= 1) {
    if (s.endsWith(marker.slice(0, n))) return n;
  }
  return 0;
}

export interface ToolStreamParser {
  push(delta: string): ParsedChunk;
  /** Flush whatever is left when the upstream stream ends. */
  end(): ParsedChunk;
  /** True once any tool block has been seen in this reply. */
  sawTool(): boolean;
}

/**
 * Create a parser for one upstream reply.
 *
 * `think` gating is deliberately limited to the START of a reply: a model
 * that opens with `<think>` is reasoning, and everything up to `</think>` is
 * discarded. A `<think>` appearing mid-answer is ordinary text (it might be
 * literal content the user asked about) and is left alone.
 */
export function createToolStreamParser(): ToolStreamParser {
  let buf = '';
  let mode: 'text' | 'tool' = 'text';
  // 'maybe' until enough characters have arrived to know whether the reply
  // opens with a reasoning block; then 'in' while inside it, 'no' forever after.
  let think: 'maybe' | 'in' | 'no' = 'maybe';
  let started = false;
  let tools = false;

  const gateThink = (): boolean => {
    // Returns true when the caller should stop processing this round (the
    // buffer is entirely reasoning, or is still too short to judge).
    if (think === 'no') return false;
    if (think === 'maybe') {
      const lead = buf.replace(/^\s+/, '');
      if (!lead) return true;
      if (!'<think>'.startsWith(lead.slice(0, 7)) && !lead.startsWith('<think>')) {
        think = 'no';
        return false;
      }
      if (!lead.startsWith('<think>')) return true; // partial "<thi…" — wait
      think = 'in';
      buf = lead.slice('<think>'.length);
    }
    const close = buf.indexOf('</think>');
    if (close === -1) {
      // Keep only what could still be a partial closing tag.
      const keep = heldBack(buf, '</think>');
      buf = buf.slice(buf.length - keep);
      return true;
    }
    buf = buf.slice(close + '</think>'.length);
    think = 'no';
    return false;
  };

  const drain = (final: boolean): ParsedChunk => {
    let text = '';
    const calls: string[] = [];
    for (;;) {
      if (mode === 'text') {
        if (gateThink()) break;
        const open = buf.indexOf(TOOL_OPEN);
        if (open === -1) {
          const keep = final ? 0 : heldBack(buf, TOOL_OPEN);
          text += buf.slice(0, buf.length - keep);
          buf = keep ? buf.slice(buf.length - keep) : '';
          break;
        }
        text += buf.slice(0, open);
        buf = buf.slice(open + TOOL_OPEN.length);
        mode = 'tool';
        tools = true;
        continue;
      }
      const close = buf.indexOf(TOOL_CLOSE);
      if (close === -1) {
        if (final && buf.trim()) {
          // Upstream stopped mid-block (token budget, dropped connection).
          // Salvage the JSON if it is complete; otherwise drop it silently —
          // half a tool block must never be rendered as assistant text.
          calls.push(buf.trim());
          buf = '';
        }
        break;
      }
      calls.push(buf.slice(0, close).trim());
      buf = buf.slice(close + TOOL_CLOSE.length);
      mode = 'text';
    }
    // Leading whitespace before the first visible character is noise.
    if (!started) {
      text = text.replace(/^\s+/, '');
      if (text) started = true;
    }
    return { text, calls };
  };

  return {
    push(delta: string): ParsedChunk {
      buf += delta;
      return drain(false);
    },
    end(): ParsedChunk {
      return drain(true);
    },
    sawTool(): boolean {
      return tools;
    },
  };
}

/** One upstream SSE line's useful payload. */
export interface UpstreamDelta {
  content?: string;
  /** Native OpenAI-style tool call fragments, when the provider emits them. */
  toolCalls?: Array<{ index: number; id?: string; name?: string; arguments?: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
  done?: boolean;
}

/**
 * Pull the useful parts out of one `data:` payload of an OpenAI-compatible
 * SSE stream. Shape-tolerant on purpose: providers disagree about where the
 * usage block lives and whether tool-call fragments carry ids.
 */
export function parseUpstreamLine(payload: string): UpstreamDelta | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  if (trimmed === '[DONE]') return { done: true };
  let j: unknown;
  try {
    j = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const o = j as {
    choices?: Array<{ delta?: { content?: unknown; tool_calls?: unknown }; message?: { content?: unknown } }>;
    usage?: unknown;
    x_groq?: { usage?: unknown };
  };
  const out: UpstreamDelta = {};
  const delta = o.choices?.[0]?.delta;
  const content = delta?.content ?? o.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content) out.content = content;
  const tc = delta?.tool_calls;
  if (Array.isArray(tc)) {
    const frags: NonNullable<UpstreamDelta['toolCalls']> = [];
    for (const raw of tc) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      frags.push({
        index: typeof r.index === 'number' ? r.index : 0,
        ...(typeof r.id === 'string' ? { id: r.id } : {}),
        ...(typeof r.function?.name === 'string' ? { name: r.function.name } : {}),
        ...(typeof r.function?.arguments === 'string' ? { arguments: r.function.arguments } : {}),
      });
    }
    if (frags.length) out.toolCalls = frags;
  }
  const u = (o.usage ?? o.x_groq?.usage) as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined | null;
  if (u && typeof u === 'object' && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number') {
    out.usage = { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens };
  }
  return Object.keys(out).length ? out : null;
}

/** Accumulator for native tool-call fragments, keyed by their stream index. */
export function createNativeToolAccumulator(): {
  add(frags: NonNullable<UpstreamDelta['toolCalls']>): void;
  finish(): Array<{ id?: string; name: string; arguments: string }>;
} {
  const byIndex = new Map<number, { id?: string; name: string; arguments: string }>();
  return {
    add(frags) {
      for (const f of frags) {
        const cur = byIndex.get(f.index) ?? { name: '', arguments: '' };
        if (f.id) cur.id = f.id;
        if (f.name) cur.name = f.name;
        if (f.arguments) cur.arguments += f.arguments;
        byIndex.set(f.index, cur);
      }
    },
    finish() {
      return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v).filter((v) => v.name);
    },
  };
}
