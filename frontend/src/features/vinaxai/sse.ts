/**
 * VinaX AI — reads the chat stream: `event:` + `data:` blocks separated by a
 * blank line, delivered in chunks that can end anywhere (even mid-character).
 * Blocks without an event name are the provider's own lines, passed through
 * by the Worker: each `data:` line comes out as a `raw` event for wire.ts.
 */
import type { StreamEvent } from './types';

/** A provider line (pass-through), its `data:` payload as text. */
export interface RawLine { event: 'raw'; data: string }
export type ChatStreamItem = StreamEvent | RawLine;

const KNOWN = new Set(['meta', 'title', 'thinking', 'text', 'error', 'done', 'sources', 'status']);

export class SseParser {
  private buf = '';
  private decoder = new TextDecoder();

  /** Feed bytes (or text); get the complete events so far. */
  push(chunk: Uint8Array | string): ChatStreamItem[] {
    this.buf += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    this.buf = this.buf.replace(/\r\n/g, '\n');
    const out: ChatStreamItem[] = [];
    let end: number;
    while ((end = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, end);
      this.buf = this.buf.slice(end + 2);
      out.push(...parseBlock(block));
    }
    return out;
  }

  /** The stream ended: a last block without its blank line still counts. */
  end(): ChatStreamItem[] {
    const rest = this.buf + this.decoder.decode();
    this.buf = '';
    return rest.trim() ? parseBlock(rest) : [];
  }
}

function parseBlock(block: string): ChatStreamItem[] {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (!data.length) return [];
  if (event === null) return data.map((d): RawLine => ({ event: 'raw', data: d }));
  if (!KNOWN.has(event)) return [];
  try {
    return [{ event, data: JSON.parse(data.join('\n')) } as StreamEvent];
  } catch {
    return [];
  }
}
