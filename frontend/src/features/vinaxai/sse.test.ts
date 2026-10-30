import { describe, expect, it } from 'vitest';
import { SseParser } from './sse';

const STREAM = 'event: meta\ndata: {"conversationId":"c"}\n\nevent: text\ndata: {"delta":"héllo"}\n\n: comment\n\nevent: unknown\ndata: {}\n\nevent: done\ndata: {"stopReason":"end"}\n\n';

describe('SseParser', () => {
  it('reads named events however the bytes are cut', () => {
    const bytes = new TextEncoder().encode(STREAM);
    for (const size of [1, 3, 17, bytes.length]) {
      const p = new SseParser();
      const out = [];
      for (let i = 0; i < bytes.length; i += size) out.push(...p.push(bytes.slice(i, i + size)));
      out.push(...p.end());
      expect(out.map((e) => e.event), `size ${size}`).toEqual(['meta', 'text', 'done']);
      expect(out[1].data).toEqual({ delta: 'héllo' });
    }
  });

  it('handles CRLF and a last block without its blank line; drops bad JSON', () => {
    const p = new SseParser();
    expect(p.push('event: text\r\ndata: {"delta":"a"}\r\n\r\nevent: text\ndata: nope\n\n')).toHaveLength(1);
    expect(p.push('event: done\ndata: {"stopReason":"end"}')).toEqual([]);
    expect(p.end()).toEqual([{ event: 'done', data: { stopReason: 'end' } }]);
  });
});
