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
}

function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.debug('[vinax:api]', ...args);
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  // Pass a DOMException so callers can distinguish a timeout abort from a
  // user-cancel abort by checking err.name === 'AbortError'. Bare abort()
  // rejects with an opaque "aborted" that swallows the reason.
  const timer = window.setTimeout(
    () => controller.abort(new DOMException('timeout', 'AbortError')),
    timeoutMs,
  );
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
  }
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
    if (pass > 0) await sleep(RETRY_BACKOFF_MS * pass);
    const ranked = healthRegistry.ranked(API_BASES);

    for (const base of ranked) {
      for (const path of req.paths) {
        const url = joinUrl(base.url, path);
        const started = performance.now();
        attempts += 1;
        try {
          const json = await fetchJson(url, timeoutMs);
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
