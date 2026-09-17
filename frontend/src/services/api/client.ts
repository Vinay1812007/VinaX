import {
  activeBases,
  FALLBACK_PASSES,
  REQUEST_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
} from '@/constants/endpoints';
import { healthRegistry } from './health';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly attempts: number = 0,
    /** HTTP status when the failure was a non-OK response; null otherwise. */
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

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

async function fetchJson(url: string, timeoutMs: number, external?: AbortSignal): Promise<unknown> {
  const prefetched = takeBootPrefetch(url);
  if (prefetched) {
    const winner = await Promise.race([
      prefetched.catch(() => null),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (winner) return winner; // null/timeout → normal fetch below
  }
  return fetchJsonNetwork(url, timeoutMs, external);
}

async function fetchJsonNetwork(url: string, timeoutMs: number, external?: AbortSignal): Promise<unknown> {
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
    if (!res.ok) throw new ApiError(`HTTP ${res.status} for ${url}`, 0, res.status);
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

/**
 * Core orchestrator: walks health-ranked endpoints, probing each known path
 * dialect, validating + normalizing payloads, recording health, and retrying
 * the whole ranked pass with backoff before giving up. The UI never sees a
 * raw upstream shape and never hard-crashes because one provider is down.
 */
export async function orchestratedRequest<T>(req: OrchestratedRequest<T>): Promise<T> {
  const timeoutMs = req.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const deadlineMs = req.deadlineMs ?? REQUEST_DEADLINE_MS;
  const startedAt = performance.now();
  const remaining = () => deadlineMs - (performance.now() - startedAt);
  let lastError: unknown = null;
  let attempts = 0;

  ladder: for (let pass = 0; pass < FALLBACK_PASSES; pass++) {
    if (isCancelled(req.signal)) throw new ApiError('cancelled', attempts);
    if (pass > 0) {
      const pause = RETRY_BACKOFF_MS * pass;
      if (remaining() <= pause) break;
      await sleep(pause, req.signal);
    }
    const ranked = healthRegistry.ranked(activeBases());

    for (const base of ranked) {
      for (const path of req.paths) {
        if (isCancelled(req.signal)) throw new ApiError('cancelled', attempts);
        // Out of budget (never before the first attempt): stop walking.
        const left = remaining();
        if (attempts > 0 && left <= 0) {
          lastError = lastError ?? new ApiError(`deadline of ${deadlineMs}ms exceeded`, attempts);
          break ladder;
        }
        const url = joinUrl(base.url, path);
        const started = performance.now();
        attempts += 1;
        // The last attempt before the deadline only gets what is left of it.
        const clipped = left < timeoutMs;
        try {
          const json = await fetchJson(url, Math.max(1, Math.min(timeoutMs, left)), req.signal);
          const value = req.validate(json);
          if (value !== null) {
            healthRegistry.recordSuccess(base.id, performance.now() - started);
            return value;
          }
          // Endpoint responded but with an unusable shape for this path —
          // soft miss: try its next path dialect without a health penalty
          // beyond a minor one.
          devLog('shape miss', base.label, path);
        } catch (err) {
          lastError = err;
          // A caller cancel is not the endpoint's fault: no health penalty,
          // and no point walking the rest of the ladder.
          if (isCancelled(req.signal)) throw new ApiError('cancelled', attempts);
          // v5.7.2 — HTTP 404 means THIS ROUTE doesn't exist on this base,
          // not that the base is down. Treat it like a shape miss: try the
          // base's next path dialect (then the next base) with no health
          // penalty. Before this, a missing route (the primary catalog has
          // no lyrics endpoints) burned a health strike per lyrics fetch and
          // could bench the healthy main music API for everything.
          if (err instanceof ApiError && err.status === 404) {
            devLog('route miss (404)', base.label, path);
            continue;
          }
          // Cut short by OUR deadline, not by its own slowness: no health strike.
          if (clipped && remaining() <= 0) break ladder;
          healthRegistry.recordFailure(base.id);
          devLog('request failed', base.label, path, err);
          break; // dead/erroring base: skip its remaining path dialects
        }
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiError('All upstream providers failed', attempts);
}
