/**
 * Server-Sent Events parsing.
 *
 * A network stream splits wherever it feels like it, which is the only
 * interesting thing about this file. A `data:` line can arrive as three
 * chunks; two events can arrive in one chunk; the last event may never be
 * terminated at all because the connection dropped. All three happen in
 * production, so all three are handled here and asserted in the tests.
 */

export interface SseMessage {
  event: string;
  data: string;
}

export interface SseParser {
  /** Feed a decoded chunk; returns whatever completed. */
  push(chunk: string): SseMessage[];
  /** Flush a final message that never got its blank line. */
  end(): SseMessage[];
}

export function createSseParser(): SseParser {
  let buf = '';

  const parseBlock = (block: string): SseMessage | null => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      const l = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (!l || l.startsWith(':')) continue;
      const colon = l.indexOf(':');
      const field = colon === -1 ? l : l.slice(0, colon);
      let value = colon === -1 ? '' : l.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (!data.length) return null;
    return { event, data: data.join('\n') };
  };

  return {
    push(chunk: string): SseMessage[] {
      buf += chunk;
      const out: SseMessage[] = [];
      for (;;) {
        // Accept both \n\n and \r\n\r\n separators.
        const lf = buf.indexOf('\n\n');
        const crlf = buf.indexOf('\r\n\r\n');
        const at = lf === -1 ? crlf : crlf === -1 ? lf : Math.min(lf, crlf);
        if (at === -1) break;
        const width = at === crlf && crlf !== -1 && (lf === -1 || crlf < lf) ? 4 : 2;
        const block = buf.slice(0, at);
        buf = buf.slice(at + width);
        const msg = parseBlock(block);
        if (msg) out.push(msg);
      }
      return out;
    },
    end(): SseMessage[] {
      const rest = buf.trim();
      buf = '';
      if (!rest) return [];
      const msg = parseBlock(rest);
      return msg ? [msg] : [];
    },
  };
}
