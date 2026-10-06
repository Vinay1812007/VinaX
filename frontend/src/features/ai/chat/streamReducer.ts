/**
 * v7.1 — the chat stream as a pure reducer.
 *
 * The service answers with server-sent events, one JSON object per frame:
 *
 *   { meta: { model } }            who is answering
 *   { delta: "text" }              the next piece of the reply
 *   { done: true, truncated? }     the end; `truncated` = cut short mid-reply
 *
 * Parsing used to live inline in the page's send() loop, tangled with React
 * state. Here it is two pure functions — split the byte stream into frames,
 * fold a frame into the state — so every odd case (a frame split across two
 * network chunks, a malformed frame, an unknown field from a newer server)
 * is covered by a unit test instead of by hope. Fields this build does not
 * know (an older server's extra meta, any other frame kind) are ignored.
 */

export interface StreamState {
  /** The reply so far. */
  text: string;
  /** Slug of the model that is actually answering (latest meta wins). */
  model: string;
  /** The service said the reply was cut short. */
  truncated: boolean;
  done: boolean;
  /** Frames that could not be understood — skipped, counted for diagnostics. */
  malformed: number;
}

export const initialStreamState = (): StreamState => ({
  text: '',
  model: '',
  truncated: false,
  done: false,
  malformed: 0,
});

/** Split what has arrived so far into complete frames plus the unfinished
 *  tail to carry into the next chunk. Frames are separated by a blank line;
 *  only `data:` frames carry a payload (comments and keep-alives are dropped).
 *  A payload that is not JSON comes back as `undefined`, which the reducer
 *  counts as malformed. */
export function splitFrames(buffer: string): { frames: unknown[]; rest: string } {
  const frames: unknown[] = [];
  let buf = buffer.replace(/\r\n/g, '\n');
  let sep = buf.indexOf('\n\n');
  while (sep >= 0) {
    const chunk = buf.slice(0, sep).trim();
    buf = buf.slice(sep + 2);
    sep = buf.indexOf('\n\n');
    if (!chunk.startsWith('data:')) continue;
    const payload = chunk.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      frames.push(JSON.parse(payload) as unknown);
    } catch {
      frames.push(undefined);
    }
  }
  return { frames, rest: buf };
}

/** Fold one frame into the state. Never throws; returns the SAME object when
 *  the frame changed nothing, so callers can skip a re-render. */
export function reduceFrame(state: StreamState, frame: unknown): StreamState {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
    return { ...state, malformed: state.malformed + 1 };
  }
  const f = frame as {
    delta?: unknown;
    done?: unknown;
    truncated?: unknown;
    meta?: { model?: unknown } | null;
  };
  let next = state;
  const set = (patch: Partial<StreamState>): void => {
    next = { ...next, ...patch };
  };
  if (f.truncated === true && !next.truncated) set({ truncated: true });
  if (f.meta && typeof f.meta === 'object') {
    if (typeof f.meta.model === 'string' && f.meta.model && f.meta.model !== next.model) set({ model: f.meta.model });
  }
  if (typeof f.delta === 'string' && f.delta) set({ text: next.text + f.delta });
  if (f.done === true && !next.done) set({ done: true });
  return next;
}
