/**
 * v7.1 — the network half of a chat turn: POST the request, read the event
 * stream, and fold it through the pure reducer. No React, no page state — the
 * caller gets a snapshot after every network chunk and the final state.
 *
 * 8.2.0 — a turn that got no stream at all because the service was briefly
 * unavailable or busy is asked ONCE more after a short pause, before the
 * listener sees any failure line (the server walks its own engine ladder, so
 * a second ask usually lands on a rested engine). A switched-off or
 * over-limit service is told apart from a transient failure and never
 * retried: waiting a second changes nothing there.
 */
import { initialStreamState, reduceFrame, splitFrames, type StreamState } from './streamReducer';

/** Why a turn produced no stream at all. `disabled` = switched off or not set
 *  up on this server; `over_budget` = today's allowance is used up.
 *  11.0 — three refusals that asking again cannot change: `bad_model` = the
 *  picked model is no longer on the server's list; `too_large` = the message
 *  (usually a picture) is over the size limit; `rejected` = the request itself
 *  was refused. None of them is re-asked automatically. */
export type StreamFailure =
  | 'offline'
  | 'busy'
  | 'unavailable'
  | 'disabled'
  | 'over_budget'
  | 'bad_model'
  | 'too_large'
  | 'rejected';

export interface ChatStreamResult {
  state: StreamState;
  /** Set when the request never produced a usable stream. */
  failure: StreamFailure | null;
  /** The listener pressed Stop (or left) — not an error. */
  aborted: boolean;
  /** 8.2.0 — how many automatic re-asks this turn needed (0 or 1). */
  retries?: number;
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
  /** 8.2.0 — pause before the one automatic re-ask. Default 1.2 s (2.5 s when busy). */
  retryDelayMs?: number;
  /** Called when the automatic re-ask starts. */
  onRetry?: (failure: StreamFailure) => void;
}

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Failures worth one more ask: nothing lasting is wrong. */
const RETRYABLE: ReadonlySet<StreamFailure> = new Set<StreamFailure>(['busy', 'unavailable']);

/** The server's JSON error code on a refused request → what the listener is told. */
export function failureFromResponse(status: number, code: unknown): StreamFailure {
  if (code === 'ai_disabled' || code === 'ai_not_configured') return 'disabled';
  if (code === 'ai_over_budget') return 'over_budget';
  if (code === 'unknown_model') return 'bad_model';
  if (status === 413 || code === 'image_too_large' || code === 'too_large') return 'too_large';
  if (status === 400) return 'rejected';
  // 429 = every engine is rate-limited; anything else (500, 502, 503) is a
  // passing upstream failure. Both are worth the one automatic re-ask.
  return status === 429 ? 'busy' : 'unavailable';
}

async function attempt(opts: ChatStreamOptions): Promise<ChatStreamResult> {
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
      const err = (await res.json().catch(() => null)) as { error?: unknown } | null;
      return { state, failure: failureFromResponse(res.status, err?.error), aborted: false };
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

/** Resolves after `ms`, or at once when the turn is stopped. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function runChatStream(opts: ChatStreamOptions): Promise<ChatStreamResult> {
  const first = await attempt(opts);
  if (!first.failure || first.aborted || first.state.text || !RETRYABLE.has(first.failure)) return first;
  await pause(opts.retryDelayMs ?? (first.failure === 'busy' ? 2_500 : 1_200), opts.signal);
  if (opts.signal.aborted) return { ...first, failure: null, aborted: true };
  opts.onRetry?.(first.failure);
  return { ...(await attempt(opts)), retries: 1 };
}

/** What the reply says when there is nothing else to show. */
export function failureMessage(failure: StreamFailure | null): string {
  if (failure === 'offline') return 'You’re offline — reconnect and ask again.';
  if (failure === 'busy') return 'That was a lot of messages at once — give it a moment, then try again.';
  if (failure === 'disabled') return 'VinaX AI is switched off right now — the rest of the app works as usual.';
  if (failure === 'over_budget') return 'VinaX AI has reached its limit for today — please try again later.';
  if (failure === 'bad_model') return 'That model is no longer available — switched to Auto.';
  if (failure === 'too_large') return 'That picture or file is too large to send — try a smaller one.';
  if (failure === 'rejected') return 'That message couldn’t be sent as it is — try rewording it or removing an attachment.';
  return 'The assistant paused — please try again.';
}

/** 11.0 — the same message would only be turned away again (too large, or
 *  refused as it is): the next step is to change it, not to Retry. */
export function needsEdit(failure: StreamFailure | null): boolean {
  return failure === 'too_large' || failure === 'rejected';
}

/** 8.2.0 — for a turn that produced no text: true when asking again could
 *  help (the Retry action). A null failure is a stream that ended empty. */
export function canRetry(failure: StreamFailure | null): boolean {
  return failure !== 'disabled' && failure !== 'over_budget';
}
