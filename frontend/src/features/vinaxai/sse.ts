/**
 * VinaX AI — reads the chat stream: `event:` + `data:` blocks separated by a
 * blank line, delivered in chunks that can end anywhere (even mid-character).
 */
import type { StreamEvent } from './types';

const KNOWN = new Set(['meta', 'title', 'thinking', 'text', 'error', 'done', 'sources', 'status']);

export class SseParser {
  private buf = '';
  private decoder = new TextDecoder();

  /** Feed bytes (or text); get the complete events so far. */
  push(chunk: Uint8Array | string): StreamEvent[] {
    this.buf += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    this.buf = this.buf.replace(/\r\n/g, '\n');
    const out: StreamEvent[] = [];
    let end: number;
    while ((end = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, end);
      this.buf = this.buf.slice(end + 2);
      const ev = parseBlock(block);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** The stream ended: a last block without its blank line still counts. */
  end(): StreamEvent[] {
    const rest = this.buf + this.decoder.decode();
    this.buf = '';
    const ev = rest.trim() ? parseBlock(rest) : null;
    return ev ? [ev] : [];
  }
}

function parseBlock(block: string): StreamEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (!KNOWN.has(event) || !data.length) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) } as StreamEvent;
  } catch {
    return null;
  }
}
