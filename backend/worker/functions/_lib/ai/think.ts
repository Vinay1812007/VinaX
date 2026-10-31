/**
 * VinaX AI — the reasoning normaliser, shared by every adapter.
 *
 * Models deliver reasoning three ways: a separate delta field (`reasoning`,
 * `reasoning_content`), `<think>…</think>` at the start of the answer text,
 * or (Gemini) thought parts. This splitter takes the first two and emits
 * `thinking` and `text` events, so raw `<think>` tags never reach the reply.
 *
 * Tags can be split across chunks: the opening tag is recognised while the
 * text so far could still be its start, and the last few characters inside
 * the block are held back until it is clear they are not the start of
 * `</think>`. A stream that ends inside the block counts as having no answer
 * (`sawText` false), so the router fails over (a lesson from the old build).
 */
import type { ProviderEvent } from './types';

const OPEN = '<think>';
const CLOSE = '</think>';
/** Reasoning kept per reply; more is dropped (it is never answer text). */
export const THINK_MAX = 20_000;

export class ThinkSplitter {
  private state: 'probe' | 'think' | 'pass' = 'probe';
  private buf = '';
  private trimLead = false;
  private thinkChars = 0;
  sawText = false;
  /** True when the stream ended still inside a <think> block. */
  unclosed = false;

  /** A reasoning delta from a separate field. */
  reasoning(delta: string): ProviderEvent[] {
    return this.think(delta);
  }

  /** An answer-text delta, which may contain <think> tags. */
  push(chunk: string): ProviderEvent[] {
    if (!chunk) return [];
    const out: ProviderEvent[] = [];
    if (this.state === 'pass') return this.text(chunk);
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
    // state === 'think'
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

  /** The stream ended: flush what is held. */
  end(): ProviderEvent[] {
    const held = this.buf;
    this.buf = '';
    if (this.state === 'think') {
      this.unclosed = true;
      return this.think(held);
    }
    return this.text(held);
  }

  private think(delta: string): ProviderEvent[] {
    if (!delta || this.thinkChars >= THINK_MAX) return [];
    const room = THINK_MAX - this.thinkChars;
    const d = delta.length > room ? delta.slice(0, room) : delta;
    this.thinkChars += d.length;
    return [{ type: 'thinking', delta: d }];
  }

  private text(delta: string): ProviderEvent[] {
    let d = delta;
    if (this.trimLead) {
      d = d.replace(/^\s+/, '');
      if (!d) return [];
      this.trimLead = false;
    }
    if (!d) return [];
    if (d.trim()) this.sawText = true;
    return [{ type: 'text', delta: d }];
  }
}
