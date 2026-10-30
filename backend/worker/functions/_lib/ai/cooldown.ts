/**
 * VinaX AI — per-isolate cooldowns. A model (or a whole provider) that just
 * failed rests for a while, and the router skips it without a request.
 * Isolates do not share this memory; that is fine, each learns on its first
 * failure. A new rest never shortens a longer one already in force.
 */
import { nextUtcMidnight, type ProviderError } from './errors';
import type { ModelSpec, ProviderId } from './types';

export const RATE_DEFAULT_MS = 60_000;
export const RATE_MAX_MS = 10 * 60_000;
export const QUOTA_DEFAULT_MS = 6 * 60 * 60_000;
export const QUOTA_MAX_MS = 24 * 60 * 60_000;
export const GONE_MS = 60 * 60_000;
export const AUTH_MS = 10 * 60_000;
export const FORBIDDEN_MS = 10 * 60_000;
export const UPSTREAM_MS = 30_000;

const rests = new Map<string, { until: number; kind: string; at: number }>();
const lastErrors = new Map<ProviderId, { kind: string; status: number | null; at: number }>();

const modelKey = (spec: Pick<ModelSpec, 'provider' | 'upstream'>): string => `${spec.provider}|${spec.upstream}`;
const providerKey = (provider: ProviderId): string => `${provider}|*`;

/** How long a failure rests what, or null when it earns no rest (timeouts, bad requests, empty answers). */
export function restFor(err: ProviderError, now = Date.now()): { scope: 'model' | 'provider'; until: number } | null {
  switch (err.kind) {
    case 'rate':
      return { scope: 'model', until: now + Math.min(RATE_MAX_MS, Math.max(1_000, err.retryAfterMs ?? RATE_DEFAULT_MS)) };
    case 'quota': {
      const until = err.untilMs ?? (err.retryAfterMs != null && err.retryAfterMs > RATE_MAX_MS ? now + err.retryAfterMs : now + QUOTA_DEFAULT_MS);
      return { scope: 'model', until: Math.min(now + QUOTA_MAX_MS, until) };
    }
    case 'gone':
      return { scope: 'model', until: err.untilMs ?? now + GONE_MS };
    case 'auth':
      return { scope: 'provider', until: now + AUTH_MS };
    case 'forbidden':
      return { scope: 'model', until: now + FORBIDDEN_MS };
    case 'upstream':
      return { scope: 'model', until: now + UPSTREAM_MS };
    default:
      return null;
  }
}

/** Record a failure: rest the model or provider, and remember the last error for the owner's Health card. */
export function noteFailure(spec: ModelSpec, err: ProviderError, now = Date.now()): void {
  lastErrors.set(spec.provider, { kind: err.kind, status: err.status, at: now });
  const rest = restFor(err, now);
  if (!rest) return;
  // Workers AI's free pool is per account: a spent pool rests every model on it.
  const key = rest.scope === 'provider' || (spec.provider === 'cloudflare' && err.kind === 'quota') ? providerKey(spec.provider) : modelKey(spec);
  const existing = rests.get(key);
  if (existing && existing.until >= rest.until) return;
  rests.set(key, { until: rest.until, kind: err.kind, at: now });
}

/** Until when this model rests (0 = not resting). */
export function coolingUntil(spec: Pick<ModelSpec, 'provider' | 'upstream'>, now = Date.now()): number {
  const a = rests.get(modelKey(spec));
  const b = rests.get(providerKey(spec.provider));
  const until = Math.max(a && a.until > now ? a.until : 0, b && b.until > now ? b.until : 0);
  return until;
}

export const isCooling = (spec: Pick<ModelSpec, 'provider' | 'upstream'>, now = Date.now()): boolean => coolingUntil(spec, now) > now;

/** What is resting now, for the owner's Health card (no secrets, no bodies). */
export function cooldownSnapshot(now = Date.now()): { rests: Array<{ key: string; kind: string; until: string }>; lastErrors: Record<string, { kind: string; status: number | null; at: string }> } {
  const list: Array<{ key: string; kind: string; until: string }> = [];
  for (const [key, r] of rests) if (r.until > now) list.push({ key, kind: r.kind, until: new Date(r.until).toISOString() });
  const errs: Record<string, { kind: string; status: number | null; at: string }> = {};
  for (const [p, e] of lastErrors) errs[p] = { kind: e.kind, status: e.status, at: new Date(e.at).toISOString() };
  return { rests: list, lastErrors: errs };
}

/** Workers AI's spent pool resets at 00:00 UTC. */
export const workersAiResetAt = nextUtcMidnight;

/** Tests only. */
export function _resetCooldowns(): void {
  rests.clear();
  lastErrors.clear();
}
