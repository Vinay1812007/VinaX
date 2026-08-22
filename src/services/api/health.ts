import {
  API_BASES,
  COOLDOWN_MS,
  MAX_CONSECUTIVE_FAILURES,
  type ApiBase,
} from '@/constants/endpoints';

export interface EndpointHealth {
  id: string;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  latencyEmaMs: number;
  cooldownUntil: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

function fresh(id: string): EndpointHealth {
  return {
    id,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    latencyEmaMs: 600,
    cooldownUntil: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
  };
}

/**
 * In-memory per-session health registry. Scores endpoints by Laplace-smoothed
 * success rate discounted by a normalized latency EMA. An endpoint that fails
 * MAX_CONSECUTIVE_FAILURES times in a row enters a cooldown (circuit breaker)
 * and is skipped until the cooldown expires — unless every endpoint is cooling
 * down, in which case all are tried anyway (graceful last resort).
 */
class HealthRegistry {
  private map = new Map<string, EndpointHealth>();

  private get(id: string): EndpointHealth {
    let h = this.map.get(id);
    if (!h) {
      h = fresh(id);
      this.map.set(id, h);
    }
    return h;
  }

  recordSuccess(id: string, latencyMs: number): void {
    const h = this.get(id);
    h.successes += 1;
    h.consecutiveFailures = 0;
    h.cooldownUntil = 0;
    h.latencyEmaMs = h.latencyEmaMs * 0.7 + latencyMs * 0.3;
    h.lastSuccessAt = Date.now();
  }

  recordFailure(id: string): void {
    const h = this.get(id);
    h.failures += 1;
    h.consecutiveFailures += 1;
    h.lastFailureAt = Date.now();
    if (h.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      h.cooldownUntil = Date.now() + COOLDOWN_MS;
    }
  }

  score(id: string): number {
    const h = this.get(id);
    const successRate = (h.successes + 1) / (h.successes + h.failures + 2);
    const latencyPenalty = Math.min(h.latencyEmaMs / 4000, 1) * 0.35;
    const recentFailurePenalty = h.consecutiveFailures * 0.1;
    return successRate - latencyPenalty - recentFailurePenalty;
  }

  isCoolingDown(id: string): boolean {
    return this.get(id).cooldownUntil > Date.now();
  }

  /** Bases ordered best-first; cooled-down bases pushed to the back. */
  ranked(bases: ApiBase[] = API_BASES): ApiBase[] {
    const active = bases.filter((b) => !this.isCoolingDown(b.id));
    const cooling = bases.filter((b) => this.isCoolingDown(b.id));
    const byScore = (a: ApiBase, b: ApiBase) => this.score(b.id) - this.score(a.id);
    return [...active.sort(byScore), ...cooling.sort(byScore)];
  }

  snapshot(): EndpointHealth[] {
    return API_BASES.map((b) => ({ ...this.get(b.id) }));
  }
}

export const healthRegistry = new HealthRegistry();
