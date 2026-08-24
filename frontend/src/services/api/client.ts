import {
  API_BASES,
  FALLBACK_PASSES,
  REQUEST_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
} from '@/constants/endpoints';
import { healthRegistry } from './health';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly attempts: number = 0,
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
}

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
    if (!res.ok) throw new ApiError(`HTTP ${res.status} for ${url}`);
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

/** True when the failure is the CALLER cancelling, not the endpoint failing. */
function isCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Core orchestrator: walks health-ranked endpoints, probing each known path
 * dialect, validating + normalizing payloads, recording health, and retrying
 * the whole ranked pass with backoff before giving up. The UI never sees a
 * raw upstream shape and never hard-crashes because one provider is down.
 */
export async function orchestratedRequest<T>(req: OrchestratedRequest<T>): Promise<T> {
  const timeoutMs = req.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let lastError: unknown = null;
  let attempts = 0;

  for (let pass = 0; pass < FALLBACK_PASSES; pass++) {
    if (isCancelled(req.signal)) throw new ApiError('cancelled', attempts);
    if (pass > 0) await sleep(RETRY_BACKOFF_MS * pass);
    const ranked = healthRegistry.ranked(API_BASES);

    for (const base of ranked) {
      for (const path of req.paths) {
        if (isCancelled(req.signal)) throw new ApiError('cancelled', attempts);
        const url = joinUrl(base.url, path);
        const started = performance.now();
        attempts += 1;
        try {
          const json = await fetchJson(url, timeoutMs, req.signal);
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
