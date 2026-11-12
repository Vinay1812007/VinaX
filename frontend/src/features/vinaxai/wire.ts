/**
 * VinaX AI — reads the provider's own stream lines inside the chat stream.
 *
 * The Worker passes the model's bytes through untouched (backend
 * passthrough.ts: relaying them token by token used up the free plan's CPU
 * and cut long replies off), so the page turns them into `thinking` and
 * `text` events itself. `meta.wire` says how they are written:
 *
 *   openai      `choices[0].delta.reasoning | reasoning_content | content` (Groq, OpenRouter, NVIDIA)
 *   gemini      `candidates[0].content.parts[]`, `thought: true` for reasoning
 *   workers-ai  `response` or `choices[0].delta.content`, `reasoning_content`
 *   anthropic   Claude's Messages API events: `content_block_delta` whose
 *               delta is `text_delta` (`text`, answer) or `thinking_delta` (`thinking`)
 *
 * Reasoning can also come as `<think>…</think>` at the start of the answer
 * text, split across chunks anywhere; the splitter holds back what could
 * still be part of a tag (the same rules as the Worker's think.ts). Errors,
 * usage and the stop reason come from the Worker's own closing events, so
 * this reads only the text.
 */
import type { StreamEvent } from './types';

export type WireFormat = 'openai' | 'gemini' | 'workers-ai' | 'anthropic';

const OPEN = '<think>';
const CLOSE = '</think>';
/** Reasoning shown per reply; the Worker keeps the same amount. */
export const THINK_MAX = 20_000;

type Delta = Extract<StreamEvent, { event: 'thinking' | 'text' }>;

export class ThinkSplitter {
  private state: 'probe' | 'think' | 'pass' = 'probe';
  private buf = '';
  private trimLead = false;
  private thinkChars = 0;

  reasoning(delta: string): Delta[] {
    return this.think(delta);
  }

  push(chunk: string): Delta[] {
    if (!chunk) return [];
    if (this.state === 'pass') return this.text(chunk);
    const out: Delta[] = [];
    this.buf += chunk;
    if (this.state === 'probe') {
      const lead = this.buf.trimStart();
      if (lead.startsWith(OPEN)) {
        this.state = 'think';
        this.buf = lead.slice(OPEN.length);
      } else if (OPEN.startsWith(lead)) {
        return out; // could still be "<thi…" (or only whitespace so far)
      } else {
        this.state = 'pass';
        const t = this.buf;
        this.buf = '';
        return this.text(t);
      }
    }
    const close = this.buf.indexOf(CLOSE);
    if (close >= 0) {
      out.push(...this.think(this.buf.slice(0, close)));
      const rest = this.buf.slice(close + CLOSE.length);
      this.buf = '';
      this.state = 'pass';
      this.trimLead = true;
      out.push(...this.text(rest));
      return out;
    }
    const keep = CLOSE.length - 1;
    if (this.buf.length > keep) {
      out.push(...this.think(this.buf.slice(0, this.buf.length - keep)));
      this.buf = this.buf.slice(this.buf.length - keep);
    }
    return out;
  }

  end(): Delta[] {
    const held = this.buf;
    this.buf = '';
    return this.state === 'think' ? this.think(held) : this.text(held);
  }

  private think(delta: string): Delta[] {
    if (!delta || this.thinkChars >= THINK_MAX) return [];
    const room = THINK_MAX - this.thinkChars;
    const d = delta.length > room ? delta.slice(0, room) : delta;
    this.thinkChars += d.length;
    return [{ event: 'thinking', data: { delta: d } }];
  }

  private text(delta: string): Delta[] {
    let d = delta;
    if (this.trimLead) {
      d = d.replace(/^\s+/, '');
      if (!d) return [];
      this.trimLead = false;
    }
    return d ? [{ event: 'text', data: { delta: d } }] : [];
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** One reply's provider lines in, `thinking` / `text` events out. */
export class WireReader {
  private split = new ThinkSplitter();

  constructor(private readonly wire: WireFormat) {}

  /** One `data:` payload. */
  push(data: string): Delta[] {
    const d = data.trim();
    if (!d || d === '[DONE]') return [];
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(d) as Record<string, unknown>;
    } catch {
      return [];
    }
    if (!j || typeof j !== 'object' || 'error' in j) return [];
    const out: Delta[] = [];
    const think = (t: string): void => { if (t) out.push(...this.split.reasoning(t)); };
    const text = (t: string): void => { if (t) out.push(...this.split.push(t)); };
    if (this.wire === 'anthropic') {
      // message_start, ping, content_block_start/stop, message_delta and message_stop carry no text.
      if (j.type === 'content_block_delta') {
        const delta = j.delta as { type?: unknown; text?: unknown; thinking?: unknown } | undefined;
        if (delta?.type === 'thinking_delta') think(str(delta.thinking));
        else if (delta?.type === 'text_delta') text(str(delta.text));
      }
    } else if (this.wire === 'gemini') {
      const cand = (j.candidates as Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }> | undefined)?.[0];
      for (const part of cand?.content?.parts ?? []) {
        if (part.thought === true) think(str(part.text));
        else text(str(part.text));
      }
    } else {
      const delta = (j.choices as Array<{ delta?: Record<string, unknown> }> | undefined)?.[0]?.delta;
      if (this.wire === 'workers-ai') {
        think(str(j.reasoning_content) || str(delta?.reasoning_content));
        text(str(j.response) || str(delta?.content));
      } else {
        think(str(delta?.reasoning) || str(delta?.reasoning_content));
        text(str(delta?.content));
      }
    }
    return out;
  }

  /** The provider's lines are over: what the splitter held back. */
  end(): Delta[] {
    return this.split.end();
  }
}

export const wireOf = (v: unknown): WireFormat => (v === 'gemini' || v === 'workers-ai' || v === 'anthropic' ? v : 'openai');
