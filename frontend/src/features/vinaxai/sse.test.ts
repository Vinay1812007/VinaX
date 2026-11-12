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

  it('Claude\'s named lines (their data repeats the event as `type`) are raw lines; the Worker\'s own error is not', () => {
    const p = new SseParser();
    const delta = '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}';
    const claudeError = '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
    const out = p.push(`event: meta\ndata: {"wire":"anthropic"}\n\nevent: message_start\ndata: {"type":"message_start","message":{}}\n\nevent: content_block_delta\ndata: ${delta}\n\nevent: error\ndata: ${claudeError}\n\nevent: error\ndata: {"code":"model_unavailable","message":"x"}\n\n`);
    expect(out).toEqual([
      { event: 'meta', data: { wire: 'anthropic' } },
      { event: 'raw', data: '{"type":"message_start","message":{}}' },
      { event: 'raw', data: delta },
      { event: 'raw', data: claudeError },
      { event: 'error', data: { code: 'model_unavailable', message: 'x' } },
    ]);
  });

  it('gives each data line of an unnamed block as a raw line (the provider\'s own, passed through)', () => {
    const p = new SseParser();
    const out = [...p.push('event: meta\ndata: {"wire":"gemini"}\n\ndata: {"a":1}\r\n\r\ndata: [DONE]\n\n: keep-alive\n\n'), ...p.push('event: done\ndata: {"stopReason":"end"}\n\n')];
    expect(out).toEqual([
      { event: 'meta', data: { wire: 'gemini' } },
      { event: 'raw', data: '{"a":1}' },
      { event: 'raw', data: '[DONE]' },
      { event: 'done', data: { stopReason: 'end' } },
    ]);
  });
});
