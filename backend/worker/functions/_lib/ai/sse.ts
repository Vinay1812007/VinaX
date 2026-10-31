/**
 * VinaX AI — Server-Sent Events, both ways.
 *
 * `sseData` reads a provider's stream: it buffers bytes into whole lines
 * (a chunk can end mid-line, or mid-character), yields the payload of each
 * `data:` line, skips `[DONE]` and comments, and handles what is left in the
 * buffer when the stream ends. `sseFrame` writes one named event for the
 * browser, one JSON object per `data:` line.
 */

export async function* sseData(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal): AsyncGenerator<string> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const onAbort = (): void => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const data = dataOf(line);
        if (data !== null) yield data;
      }
    }
    buf += decoder.decode();
    const data = dataOf(buf);
    if (data !== null) yield data;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

function dataOf(raw: string): string | null {
  const line = raw.replace(/\r$/, '');
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  return data;
}

/** Parse a JSON payload; null when it is not JSON (dropped, never fatal). */
export function parseJson<T = Record<string, unknown>>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

const enc = new TextEncoder();

/** One SSE frame for the browser. */
export function sseFrame(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
