/**
 * v7.1 — the network half of a chat turn: POST the request, read the event
 * stream, and fold it through the pure reducer. No React, no page state — the
 * caller gets a snapshot after every network chunk and the final state.
 */
import { initialStreamState, reduceFrame, splitFrames, type StreamState } from './streamReducer';

/** Why a turn produced no stream at all. */
export type StreamFailure = 'offline' | 'busy' | 'unavailable';

export interface ChatStreamResult {
  state: StreamState;
  /** Set when the request never produced a usable stream. */
  failure: StreamFailure | null;
  /** The listener pressed Stop (or left) — not an error. */
  aborted: boolean;
}

export interface ChatStreamOptions {
  endpoint: string;
  headers?: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
  /** Every text delta, in order — the live-voice engine speaks from these. */
  onDelta?: (delta: string) => void;
  /** After each network chunk that changed something. */
  onUpdate?: (state: StreamState) => void;
}

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

export async function runChatStream(opts: ChatStreamOptions): Promise<ChatStreamResult> {
  let state = initialStreamState();
  if (isOffline()) return { state, failure: 'offline', aborted: false };
  try {
    const res = await fetch(opts.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: JSON.stringify(opts.body),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      return { state, failure: res.status === 429 ? 'busy' : 'unavailable', aborted: false };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const { frames, rest } = splitFrames(buf + dec.decode(value, { stream: true }));
      buf = rest;
      const before = state;
      for (const frame of frames) {
        const prevText = state.text;
        state = reduceFrame(state, frame);
        if (opts.onDelta && state.text.length > prevText.length) opts.onDelta(state.text.slice(prevText.length));
      }
      if (state !== before) opts.onUpdate?.(state);
    }
    return { state, failure: null, aborted: false };
  } catch {
    const aborted = opts.signal.aborted;
    // A stream that broke after text arrived is a partial answer, not a
    // failure: the caller keeps what it has.
    return { state, failure: aborted || state.text ? null : isOffline() ? 'offline' : 'unavailable', aborted };
  }
}

/** What the reply says when there is nothing else to show. */
export function failureMessage(failure: StreamFailure | null): string {
  if (failure === 'offline') return 'You’re offline — reconnect and ask again.';
  if (failure === 'busy') return 'That was a lot of messages at once — give it a moment, then try again.';
  return 'The assistant paused — please try again.';
}
