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

/** Read a VinaX SSE response into [event, data] pairs. */
export async function readEvents(res: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await res.text();
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of text.split('\n\n')) {
    const ev = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (ev && data) out.push({ event: ev, data: JSON.parse(data) as Record<string, unknown> });
  }
  return out;
}
