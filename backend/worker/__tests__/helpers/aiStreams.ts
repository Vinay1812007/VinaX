/**
 * Helpers for the VinaX AI tests: recorded provider streams (fixtures/ai),
 * cut into chunks at awkward places, so every parser sees lines, tags and
 * characters split across reads.
 */
import { readFileSync } from 'node:fs';

export const fixture = (name: string): string => readFileSync(new URL(`../fixtures/ai/${name}`, import.meta.url), 'utf8');

/** A byte stream that delivers `text` in chunks of `size` bytes (1 = byte by byte). */
export function streamOf(text: string, size = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) {
        c.close();
        return;
      }
      c.enqueue(bytes.slice(i, i + size));
      i += size;
    },
  });
}

export const sseResponse = (text: string, size = 7, status = 200): Response =>
  new Response(streamOf(text, size), { status, headers: { 'content-type': 'text/event-stream' } });

/** OpenAI-style SSE for a plain answer, one delta per word. */
export function openAiSse(answer: string, opts: { reasoning?: string; finish?: string } = {}): string {
  const frames: string[] = [];
  if (opts.reasoning) frames.push(JSON.stringify({ choices: [{ index: 0, delta: { reasoning: opts.reasoning } }] }));
  for (const word of answer.split(/(?<= )/)) frames.push(JSON.stringify({ choices: [{ index: 0, delta: { content: word } }] }));
  frames.push(JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: opts.finish ?? 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } }));
  return frames.map((f) => `data: ${f}\n\n`).join('') + 'data: [DONE]\n\n';
}

/** Anthropic Messages API SSE for an answer (one text delta per word), with optional thinking. */
export function anthropicSse(answer: string, opts: { thinking?: string; stop?: string; input?: number; output?: number } = {}): string {
  const ev = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], usage: { input_tokens: opts.input ?? 12, output_tokens: 1 } } });
  let i = 0;
  if (opts.thinking) {
    out += ev('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '' } });
    out += ev('content_block_delta', { index: i, delta: { type: 'thinking_delta', thinking: opts.thinking } });
    out += ev('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: 'sig' } });
    out += ev('content_block_stop', { index: i });
    i++;
  }
  out += ev('ping', {});
  out += ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
  for (const word of answer ? answer.split(/(?<= )/) : []) out += ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: word } });
  out += ev('content_block_stop', { index: i });
  out += ev('message_delta', { delta: { stop_reason: opts.stop ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: opts.output ?? 7 } });
  out += ev('message_stop', {});
  return out;
}

/**
 * Read a VinaX SSE response into [event, data] pairs. The provider's own
 * lines (pass-through, no event name) become `thinking` / `text` events the
 * way the page reads them (frontend vinaxai/wire.ts), by the `wire` in meta.
 */
export async function readEvents(res: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = (await res.text()).replace(/\r\n/g, '\n');
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];
  let wire = 'openai';
  let inThink = false;
  const push = (event: 'thinking' | 'text', delta: unknown): void => {
    if (typeof delta !== 'string' || !delta) return;
    if (event === 'text') {
      // <think> tags at the start of the answer are reasoning.
      let d = delta;
      if (d.includes('<think>')) { inThink = true; d = d.replace('<think>', ''); }
      if (inThink) {
        const close = d.indexOf('</think>');
        if (close < 0) { out.push({ event: 'thinking', data: { delta: d } }); return; }
        if (close > 0) out.push({ event: 'thinking', data: { delta: d.slice(0, close) } });
        inThink = false;
        d = d.slice(close + 8).replace(/^\s+/, '');
        if (!d) return;
      }
      out.push({ event: 'text', data: { delta: d } });
    } else out.push({ event, data: { delta } });
  };
  for (const block of text.split('\n\n')) {
    const ev = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: ?(.+)$/m.exec(block)?.[1];
    if (!data) continue;
    // Claude's lines name their event and repeat it as `type` (frontend sse.ts): the provider's.
    const claudeLine = !!ev && (JSON.parse(data) as { type?: unknown }).type === ev;
    if (ev && !claudeLine) {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      if (ev === 'meta' && typeof parsed.wire === 'string') wire = parsed.wire;
      out.push({ event: ev, data: parsed });
      continue;
    }
    if (data.trim() === '[DONE]') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a provider chunk of any shape
    let j: any;
    try { j = JSON.parse(data); } catch { continue; }
    if (wire === 'anthropic') {
      if (j.type === 'content_block_delta') {
        if (j.delta?.type === 'thinking_delta') push('thinking', j.delta.thinking);
        else if (j.delta?.type === 'text_delta') push('text', j.delta.text);
      }
    } else if (wire === 'gemini') {
      for (const part of j.candidates?.[0]?.content?.parts ?? []) push(part.thought === true ? 'thinking' : 'text', part.text);
    } else if (wire === 'workers-ai') {
      push('thinking', j.reasoning_content ?? j.choices?.[0]?.delta?.reasoning_content);
      push('text', j.response ?? j.choices?.[0]?.delta?.content);
    } else {
      const d = j.choices?.[0]?.delta;
      push('thinking', d?.reasoning ?? d?.reasoning_content);
      push('text', d?.content);
    }
  }
  return out;
}
