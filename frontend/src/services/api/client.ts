import {
  activeBases,
  FALLBACK_PASSES,
  REQUEST_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
  type ApiBase,
} from '@/constants/endpoints';
import { healthRegistry, parseRetryAfter } from './health';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly attempts: number = 0,
    /** HTTP status when the failure was a non-OK response; null otherwise. */
    public readonly status: number | null = null,
    /** 429 / 503: the endpoint's Retry-After, in ms (null when absent). */
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 10.1 allotment. `interactive` (search, typeahead, song lookup): best
 * endpoint first, hedged to the next one past its p75. `background`
 * (shelves, prefetch): spread across healthy endpoints by weight, never
 * hedged. `standard`: best endpoint first, no hedge.
 */
export type RequestPriority = 'interactive' | 'standard' | 'background';

export interface OrchestratedRequest<T> {
  /**
   * Path candidates, tried in order per endpoint. Wrappers expose slightly
   * different route dialects ("/songs/:id" vs "/songs?id="), so each domain
   * function lists every dialect it knows.
   */
  paths: string[];
  /**
   * Validator + normalizer. Returns the typed value, or null when the payload
   * does not contain usable data — a null causes fall-through to the next
   * path/endpoint instead of surfacing garbage to the UI.
   */
  validate: (json: unknown) => T | null;
  timeoutMs?: number;
  /**
   * Caller-side cancellation (delta audit P1-13) — TanStack Query aborts this
   * when the query key changes or the component unmounts, so every keystroke
   * stops the previous keystroke's network work. A cancel aborts the in-flight
   * fetch AND short-circuits the fallback ladder, and is never recorded as an
   * endpoint-health failure (the endpoint did nothing wrong).
   */
  signal?: AbortSignal;
  /**
   * Overall budget for the whole ladder (every base × path dialect × pass).
   * Per-attempt timeouts alone let one request spend the best part of a minute
   * walking dead bases while the UI sat on a skeleton; past the deadline the
   * walk stops and the last error surfaces. An attempt already in flight is
   * cut short at the deadline too.
   */
  deadlineMs?: number;
  /** How this call is allotted across endpoints (default `standard`). */
  priority?: RequestPriority;
  /** Opt-in: identical calls within this many ms share one network call
   *  and its answer. Only for side-effect-free GETs whose paths fully
   *  identify the result. */
  cacheMs?: number;
}

/** Default overall budget for one orchestrated request. */
export const REQUEST_DEADLINE_MS = 20_000;

function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.debug('[vinax:api]', ...args);
}

/**
 * First-shelf boot prefetch (4.18.2). index.html fires the cold-load trending
 * request from an inline script — in parallel with the JS download — and
 * parks {url, json} on window.__vxBoot. The first fetchJson whose URL matches
 * by path + query consumes it (single use); anything else — mismatch, upstream
 * failure (json resolves null), or a hung request outlasting the caller's
 * timeout — falls through to the normal network path. Worst case equals the
 * old behavior; best case removes the whole JS-parse leg from the LCP chain.
 *
 * Matching is on normalized pathname+search (not byte-for-byte): index.html
 * parks an ABSOLUTE url (origin + /api/cat/...) while the client requests the
 * same-origin RELATIVE path (/api/cat/...) — exact string equality could
 * never match, which silently disabled the prefetch. Both sides resolve
 * against location.href before comparing.
 */
function takeBootPrefetch(url: string): Promise<unknown> | null {
  const w = window as unknown as { __vxBoot?: { url: string; json: Promise<unknown> } | null };
  const boot = w.__vxBoot;
  if (!boot || typeof boot.json?.then !== 'function') return null;
  const norm = (u: string): string | null => {
    try {
      const abs = new URL(u, location.href);
      return abs.pathname + abs.search;
    } catch {
      return null;
    }
  };
  const a = norm(boot.url);
  const b = norm(url);
  if (a === null || b === null || a !== b) return null;
  w.__vxBoot = null;
  return boot.json;
}

/** 10.1 — the boot prefetch is matched against EVERY endpoint × dialect
 *  before allotment, so a spread (background) call still consumes it. */
async function bootAnswer(urls: string[], timeoutMs: number): Promise<unknown> {
  for (const url of urls) {
    const prefetched = takeBootPrefetch(url);
    if (!prefetched) continue;
    return Promise.race([
      prefetched.catch(() => null),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }
  return null;
}

async function fetchJson(url: string, timeoutMs: number, external?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  // Pass a DOMException so callers can distinguish a timeout abort from a
  // user-cancel abort by checking err.name === 'AbortError'. Bare abort()
  // rejects with an opaque "aborted" that swallows the reason.
  const timer = window.setTimeout(
    () => controller.abort(new DOMException('timeout', 'AbortError')),
    timeoutMs,
  );
  const onCancel = () => controller.abort(new DOMException('cancelled', 'AbortError'));
  if (external?.aborted) onCancel();
  else external?.addEventListener('abort', onCancel, { once: true });
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const limited = res.status === 429 || res.status === 503;
      throw new ApiError(
        `HTTP ${res.status} for ${url}`,
        0,
        res.status,
        limited ? parseRetryAfter(res.headers.get('retry-after')) : null,
      );
    }
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(`timeout after ${timeoutMs}ms for ${url}`);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
    external?.removeEventListener('abort', onCancel);
  }
}

/**
 * A plain `fetch` that cannot hang: aborts after `timeoutMs`, and at once when
 * the caller's signal aborts. For same-origin helpers outside the catalogue
 * ladder (trending searches), which used to wait on the browser's own timeout.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(new DOMException('timeout', 'AbortError')),
    timeoutMs,
  );
  const onCancel = () => controller.abort(new DOMException('cancelled', 'AbortError'));
  if (external?.aborted) onCancel();
  else external?.addEventListener('abort', onCancel, { once: true });
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } finally {
    window.clearTimeout(timer);
    external?.removeEventListener('abort', onCancel);
  }
}

/** True when the failure is the CALLER cancelling, not the endpoint failing. */
function isCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Backoff pause that ends early when the caller cancels — a cancelled
 *  request must not sit out the rest of its backoff before noticing. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = window.setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

type Outcome<T> =
  | { kind: 'value'; value: T }
  | { kind: 'miss' }
  | { kind: 'fail'; error: unknown }
  | { kind: 'deadline'; error: unknown }
  | { kind: 'aborted' };

interface Ladder {
  timeoutMs: number;
  remaining: () => number;
  attempts: number;
}

/**
 * One endpoint, every path dialect in order. Never rejects: the outcome says
 * whether it answered, missed (shape / 404 on every dialect), failed, ran out
 * of the overall budget, or was aborted (caller cancel or a lost hedge).
 */
async function attemptBase<T>(
  base: ApiBase,
  req: OrchestratedRequest<T>,
  ladder: Ladder,
  interactive: boolean,
  signal: AbortSignal,
): Promise<Outcome<T>> {
  if (!(await healthRegistry.acquire(base.id, interactive, signal))) return { kind: 'aborted' };
  try {
    for (const path of req.paths) {
      if (signal.aborted) return { kind: 'aborted' };
      // Out of budget (never before the first attempt): stop walking.
      const left = ladder.remaining();
      if (ladder.attempts > 0 && left <= 0) {
        return { kind: 'deadline', error: new ApiError('deadline exceeded', ladder.attempts) };
      }
      const url = joinUrl(base.url, path);
      const started = performance.now();
      ladder.attempts += 1;
      // The last attempt before the deadline only gets what is left of it.
      const clipped = left < ladder.timeoutMs;
      try {
        const json = await fetchJson(url, Math.max(1, Math.min(ladder.timeoutMs, left)), signal);
        const value = req.validate(json);
        if (value !== null) {
          healthRegistry.recordSuccess(base.id, performance.now() - started);
          return { kind: 'value', value };
        }
        // Answered with an unusable shape for this path: try the next
        // dialect, no health penalty.
        devLog('shape miss', base.label, path);
      } catch (err) {
        // A caller cancel or a lost hedge is not the endpoint's fault.
        if (signal.aborted) return { kind: 'aborted' };
        const status = err instanceof ApiError ? err.status : null;
        // v5.7.2 — HTTP 404 means THIS ROUTE doesn't exist on this base, not
        // that the base is down: try its next dialect with no penalty (a
        // missing lyrics route once benched the healthy main catalogue).
        if (status === 404) {
          devLog('route miss (404)', base.label, path);
          continue;
        }
        // 10.1 — 429 / 503: honour Retry-After, cool this endpoint, allot
        // the call elsewhere.
        if (status === 429 || status === 503) {
          healthRegistry.recordRateLimited(base.id, (err as ApiError).retryAfterMs);
          return { kind: 'fail', error: err };
        }
        // Cut short by OUR deadline, not by its own slowness: no health strike.
        if (clipped && ladder.remaining() <= 0) return { kind: 'deadline', error: err };
        healthRegistry.recordFailure(base.id);
        devLog('request failed', base.label, path, err);
        return { kind: 'fail', error: err }; // skip its remaining dialects
      }
    }
    return { kind: 'miss' };
  } finally {
    healthRegistry.release(base.id);
  }
}

interface Live<T> {
  base: ApiBase;
  started: number;
  controller: AbortController;
  done: Promise<{ live: Live<T>; outcome: Outcome<T> }>;
  unlink: () => void;
}

/**
 * One pass over the allotted endpoints. Interactive calls hedge: when the
 * endpoint in flight has not answered within its own p75 (bounded
 * HEDGE_MIN_MS..HEDGE_MAX_MS), the same request goes to the next endpoint and
 * the first valid answer wins; the loser is aborted. Everything else walks
 * the endpoints one at a time.
 */
async function runPass<T>(
  order: ApiBase[],
  req: OrchestratedRequest<T>,
  ladder: Ladder,
  priority: RequestPriority,
): Promise<{ value: T } | { stop: unknown } | { error: unknown }> {
  const interactive = priority === 'interactive';
  const live = new Set<Live<T>>();
  let next = 0;
  let hedges = interactive ? 1 : 0;
  let lastError: unknown = null;

  const launch = (): void => {
    const base = order[next++];
    if (!base) return;
    const controller = new AbortController();
    const link = () => controller.abort();
    if (req.signal?.aborted) controller.abort();
    else req.signal?.addEventListener('abort', link, { once: true });
    const entry = {
      base,
      started: performance.now(),
      controller,
      unlink: () => req.signal?.removeEventListener('abort', link),
    } as Live<T>;
    entry.done = attemptBase(base, req, ladder, interactive, controller.signal).then((outcome) => ({
      live: entry,
      outcome,
    }));
    live.add(entry);
  };
  const abortRest = (): void => {
    for (const l of live) {
      l.controller.abort();
      l.unlink();
      healthRegistry.recordSlow(l.base.id, performance.now() - l.started);
    }
    live.clear();
  };

  launch();
  while (live.size > 0) {
    const racers: Promise<{ live: Live<T>; outcome: Outcome<T> } | 'hedge'>[] = [...live].map((l) => l.done);
    let timer = 0;
    if (hedges > 0 && live.size === 1 && next < order.length) {
      const [only] = live;
      const wait = healthRegistry.hedgeDelayMs(only.base.id) - (performance.now() - only.started);
      racers.push(
        new Promise((resolve) => {
          timer = window.setTimeout(() => resolve('hedge'), Math.max(0, wait));
        }),
      );
    }
    const first = await Promise.race(racers);
    window.clearTimeout(timer);
    if (first === 'hedge') {
      hedges -= 1;
      devLog('hedge', order[next]?.label);
      launch();
      continue;
    }
    const { live: done, outcome } = first;
    live.delete(done);
    done.unlink();
    if (outcome.kind === 'value') {
      abortRest();
      return { value: outcome.value };
    }
    if (outcome.kind === 'aborted' || isCancelled(req.signal)) {
      abortRest();
      return { stop: new ApiError('cancelled', ladder.attempts) };
    }
    if (outcome.kind === 'deadline') {
      abortRest();
      return { stop: lastError ?? outcome.error };
    }
    if (outcome.kind === 'fail') lastError = outcome.error;
    // Nothing else in flight: fall through to the next endpoint now.
    if (live.size === 0) launch();
  }
  return { error: lastError };
}

/**
 * Core orchestrator: allots each request across health-ranked endpoints,
 * probing each known path dialect, validating + normalizing payloads,
 * recording health, and retrying the whole pass with backoff before giving
 * up. The UI never sees a raw upstream shape and never hard-crashes because
 * one provider is down.
 */
async function runLadder<T>(req: OrchestratedRequest<T>): Promise<T> {
  const deadlineMs = req.deadlineMs ?? REQUEST_DEADLINE_MS;
  const priority = req.priority ?? 'standard';
  const startedAt = performance.now();
  const ladder: Ladder = {
    timeoutMs: req.timeoutMs ?? REQUEST_TIMEOUT_MS,
    remaining: () => deadlineMs - (performance.now() - startedAt),
    attempts: 0,
  };
  let lastError: unknown = null;

  for (let pass = 0; pass < FALLBACK_PASSES; pass++) {
    if (isCancelled(req.signal)) throw new ApiError('cancelled', ladder.attempts);
    if (pass > 0) {
      const pause = RETRY_BACKOFF_MS * pass;
      if (ladder.remaining() <= pause) break;
      await sleep(pause, req.signal);
      if (isCancelled(req.signal)) throw new ApiError('cancelled', ladder.attempts);
    }
    const bases = activeBases();
    if (pass === 0) {
      const urls = bases.flatMap((b) => req.paths.map((p) => joinUrl(b.url, p)));
      const booted = await bootAnswer(urls, ladder.timeoutMs);
      const value = booted ? req.validate(booted) : null;
      if (value !== null) return value; // null / timeout / bad shape → network below
    }
    const order = priority === 'background' ? healthRegistry.spread(bases) : healthRegistry.ranked(bases);
    // An endpoint that asked us to back off gets nothing until Retry-After
    // has passed — unless it is the only one left.
    const allowed = order.filter((b) => !healthRegistry.isRateLimited(b.id));
    const result = await runPass(allowed.length ? allowed : order, req, ladder, priority);
    if ('value' in result) return result.value;
    if ('stop' in result) {
      if (isCancelled(req.signal)) throw new ApiError('cancelled', ladder.attempts);
      lastError = result.stop ?? lastError;
      break;
    }
    lastError = result.error ?? lastError;
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiError('All upstream providers failed', ladder.attempts);
}

// 10.1 — identical GETs within a few seconds (typeahead repeats, two shelves
// asking the same thing) share one network call and one short-lived answer.
const MEMO_MAX = 40;
const memo = new Map<string, { at: number; value: unknown }>();
interface Shared {
  promise: Promise<unknown>;
  controller: AbortController;
  users: number;
}
const shared = new Map<string, Shared>();

/** Test hook. */
export function clearRequestMemo(): void {
  memo.clear();
  shared.clear();
}

export function orchestratedRequest<T>(req: OrchestratedRequest<T>): Promise<T> {
  const ttl = req.cacheMs ?? 0;
  if (ttl <= 0) return runLadder(req);
  const key = req.paths.join('\n');
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value as T);
  if (req.signal?.aborted) return Promise.reject(new ApiError('cancelled'));
  let entry = shared.get(key);
  if (!entry) {
    const controller = new AbortController();
    const created: Shared = {
      controller,
      users: 0,
      promise: runLadder({ ...req, signal: controller.signal }).then((value) => {
        memo.delete(key);
        memo.set(key, { at: Date.now(), value });
        while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
        return value as unknown;
      }),
    };
    void created.promise
      .catch(() => undefined)
      .finally(() => {
        if (shared.get(key) === created) shared.delete(key);
      });
    shared.set(key, created);
    entry = created;
  }
  const own = entry;
  own.users += 1;
  return new Promise<T>((resolve, reject) => {
    let left = false;
    const leave = (): boolean => {
      if (left) return false;
      left = true;
      own.users -= 1;
      req.signal?.removeEventListener('abort', onAbort);
      return true;
    };
    // The shared call is cancelled only once every caller has gone.
    const onAbort = (): void => {
      if (!leave()) return;
      if (own.users === 0) {
        if (shared.get(key) === own) shared.delete(key);
        own.controller.abort();
      }
      reject(new ApiError('cancelled'));
    };
    req.signal?.addEventListener('abort', onAbort, { once: true });
    own.promise.then(
      (value) => {
        if (leave()) resolve(value as T);
      },
      (err: unknown) => {
        if (leave()) reject(err);
      },
    );
  });
}
