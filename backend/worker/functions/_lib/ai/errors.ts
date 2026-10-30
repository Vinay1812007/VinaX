/**
 * VinaX AI — one error type for every provider failure, with the reason the
 * router needs (fail over? rest the model? for how long?). Upstream bodies
 * are read only to classify; they never reach a reply or a log.
 */

export type ProviderErrorKind =
  | 'rate'        // 429: slow down for a while
  | 'quota'       // a daily or free allowance is spent
  | 'gone'        // 404/410, unknown model
  | 'auth'        // 401/402: the key is refused (rests the whole provider)
  | 'forbidden'   // 403: this model is refused for this key
  | 'upstream'    // 5xx, or the provider broke the stream
  | 'bad_request' // other 4xx: this request will not work on this model
  | 'timeout'     // no first event in time, or the reply ran past its budget
  | 'network'     // fetch itself failed
  | 'empty'       // the stream ended with no answer text (or only reasoning)
  | 'not_configured';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | null;
  /** How long the provider asked us to wait (429 retry-after / retryDelay). */
  readonly retryAfterMs: number | null;
  /** When the allowance resets, if the provider said (absolute ms). */
  readonly untilMs: number | null;

  constructor(kind: ProviderErrorKind, opts: { status?: number | null; retryAfterMs?: number | null; untilMs?: number | null } = {}) {
    super(kind);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.untilMs = opts.untilMs ?? null;
  }
}

/** Phrases that mean "the daily or free allowance is spent", not "slow down". */
const QUOTA_SPENT = /PerDay|per day|daily|exceeded your current quota|check your plan and billing|free[- ]tier|free.{0,20}(limit|quota)|\blimit:\s*0\b|"quotaValue"\s*:\s*"0"|tokens per day|requests per day|\bTPD\b|\bRPD\b/i;

function retryAfterMs(headers: Headers | null, body: string): number | null {
  const h = headers?.get('retry-after');
  if (h) {
    const s = Number(h);
    if (Number.isFinite(s) && s >= 0) return Math.ceil(s * 1000);
    const at = Date.parse(h);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i.exec(body);
  if (delay) return Math.ceil(Number(delay[1]) * 1000);
  const groq = /try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/i.exec(body);
  if (groq) return Math.ceil(((Number(groq[1] ?? 0) * 60) + Number(groq[2])) * 1000);
  return null;
}

/** Classify a failed HTTP answer. `body` is at most a few KB of the error text. */
export function classifyHttp(status: number, headers: Headers | null, body: string): ProviderError {
  const wait = retryAfterMs(headers, body);
  if (status === 429) {
    if (QUOTA_SPENT.test(body)) return new ProviderError('quota', { status, retryAfterMs: wait });
    return new ProviderError('rate', { status, retryAfterMs: wait });
  }
  if (status === 404 || status === 410) return new ProviderError('gone', { status });
  if (status === 401 || status === 402) return new ProviderError('auth', { status });
  if (status === 403) return new ProviderError('forbidden', { status });
  if (status === 413) return new ProviderError('bad_request', { status });
  if (status >= 500) return new ProviderError('upstream', { status });
  return new ProviderError('bad_request', { status });
}

/** Read at most `cap` bytes of an error body as text (never thrown). */
export async function errorText(res: Response, cap = 4_096): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, cap);
  } catch {
    return '';
  }
}

/** Next 00:00 UTC after `now`. */
export function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** Normalise anything thrown by fetch/an adapter into a ProviderError. */
export function asProviderError(e: unknown, signal?: AbortSignal): ProviderError {
  if (e instanceof ProviderError) return e;
  if (signal?.aborted) {
    const reason: unknown = signal.reason;
    if (reason instanceof ProviderError) return reason;
    return new ProviderError('timeout');
  }
  return new ProviderError('network');
}
