/**
 * Size-capped request-body reads shared by the JSON routes.
 *
 * `request.json()` / `request.text()` buffer the WHOLE body before any size
 * check can run, and content-length is absent on a chunked upload — so the
 * declared length is only the cheap first gate. The real guard is the capped
 * streaming read: it stops (and cancels the stream) the moment the byte count
 * passes the cap, so an oversized body never sits in isolate memory.
 */

/** Read at most `cap` bytes; null means the body ran past the cap. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export type CappedJson<T> = { ok: true; value: T } | { ok: false; reason: 'too_large' | 'bad_json' };

/**
 * Parse a JSON request body of at most `cap` bytes. `too_large` maps to a 413,
 * `bad_json` to whatever the route already answers for a malformed body. The
 * parsed value is NOT shape-checked — callers keep validating every field.
 */
export async function readJsonCapped<T>(request: Request, cap: number): Promise<CappedJson<T>> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > cap) return { ok: false, reason: 'too_large' };
  let raw: Uint8Array | null;
  try {
    raw = await readCapped(request.body, cap);
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  if (raw === null) return { ok: false, reason: 'too_large' };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(raw)) as T };
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
}
