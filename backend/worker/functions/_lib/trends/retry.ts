/**
 * Bounded retries with jitter for one provider fetch.
 *
 * Only failures a retry can fix are retried: a timeout, a network error, a
 * 5xx or a 429. A refused key, an exhausted quota or an unknown chart fails
 * at once — retrying those only burns quota. Every attempt runs under its own
 * deadline, and the caller's signal (the whole job's budget) cancels both the
 * attempt and any pause between attempts.
 */
import { TrendFetchError } from './types';

export interface RetryOptions {
  attempts?: number;
  /** First backoff; doubles each retry, capped at `maxDelayMs`. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Uniform random jitter added to every backoff, so parallel runs do not retry in step. */
  jitterMs?: number;
  /** Deadline for ONE attempt. */
  attemptTimeoutMs?: number;
  signal?: AbortSignal;
  /** Injected for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface RetryOutcome<T> {
  value: T;
  attempts: number;
}

export class RetryFailure extends Error {
  readonly attempts: number;
  readonly last: TrendFetchError;
  constructor(last: TrendFetchError, attempts: number) {
    super(last.message);
    this.name = 'RetryFailure';
    this.last = last;
    this.attempts = attempts;
  }
}

export const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

/** Delay before retry number `retry` (1-based): base × 2^(retry−1), capped, plus jitter. */
export function backoffDelay(retry: number, opts: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'jitterMs' | 'random'>): number {
  const base = opts.baseDelayMs ?? 500;
  const cap = opts.maxDelayMs ?? 4_000;
  const jitter = opts.jitterMs ?? 250;
  const rnd = opts.random ?? Math.random;
  return Math.min(cap, base * 2 ** Math.max(0, retry - 1)) + Math.floor(rnd() * jitter);
}

/** Normalise anything thrown by an attempt into a TrendFetchError. */
export function asFetchError(err: unknown, timedOut: boolean): TrendFetchError {
  if (err instanceof TrendFetchError) return err;
  if (timedOut) return new TrendFetchError('timeout', 'The provider did not answer in time', { retryable: true });
  const name = (err as { name?: string } | null)?.name;
  if (name === 'AbortError') return new TrendFetchError('aborted', 'The run was cancelled', { retryable: false });
  return new TrendFetchError('network', err instanceof Error ? err.message : 'Network failure', { retryable: true });
}

export async function withRetries<T>(run: (signal: AbortSignal) => Promise<T>, opts: RetryOptions = {}): Promise<RetryOutcome<T>> {
  const attempts = Math.max(1, Math.min(5, opts.attempts ?? 3));
  const sleep = opts.sleep ?? defaultSleep;
  let last: TrendFetchError | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (opts.signal?.aborted) {
      throw new RetryFailure(new TrendFetchError('aborted', 'The run was cancelled', { retryable: false }), attempt - 1);
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.attemptTimeoutMs ?? 8_000);
    const onParentAbort = (): void => controller.abort();
    opts.signal?.addEventListener('abort', onParentAbort, { once: true });
    // The deadline holds even if `run` ignores its signal: the race settles on abort.
    const abandoned = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    });
    abandoned.catch(() => undefined);
    try {
      const value = await Promise.race([run(controller.signal), abandoned]);
      return { value, attempts: attempt };
    } catch (err) {
      last = asFetchError(err, timedOut);
      if (!last.retryable || attempt === attempts || opts.signal?.aborted) throw new RetryFailure(last, attempt);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onParentAbort);
    }
    await sleep(backoffDelay(attempt, opts), opts.signal);
  }
  // Unreachable: the loop either returns or throws.
  throw new RetryFailure(last ?? new TrendFetchError('unknown', 'No attempt ran', { retryable: false }), attempts);
}
