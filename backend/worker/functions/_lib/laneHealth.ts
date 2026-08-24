/**
 * Package B11 — lane-health aggregation for the AI Lab bench.
 *
 * Rows come straight from vinax_ai_events (trailing window). The `model`
 * column carries "model @role" — the @role suffix IS the lane. Pure module so
 * the percentile math and error-class counting are unit-testable.
 */

export interface AiEventRow {
  model: string | null;
  ok: boolean | null;
  status?: number | null;
  error: string | null;
  latency_ms: number | null;
}

export interface LaneHealth {
  lane: string;
  calls: number;
  okPct: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  /** Failover hops: a sibling lane had to cover this one (or it timed out). */
  hops: number;
  /** 200-OK streams that produced no content and needed a rescue. */
  emptyStreams: number;
  /** B3 — times the model asked for a live search itself. */
  selfSearches: number;
  /** E5 — 401/403/429 responses: a key in quota trouble or revoked. */
  authErrors: number;
}

/** Nearest-rank percentile over an ASCENDING-sorted array. Null when empty. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function laneOf(model: string | null): string {
  const m = /@([a-z-]+)\s*$/.exec(model ?? '');
  return m ? m[1] : 'unknown';
}

export function aggregateLaneHealth(rows: AiEventRow[]): LaneHealth[] {
  const byLane = new Map<string, { lat: number[]; calls: number; ok: number; hops: number; empty: number; fetch: number; auth: number }>();
  for (const r of rows) {
    const lane = laneOf(r.model);
    let b = byLane.get(lane);
    if (!b) {
      b = { lat: [], calls: 0, ok: 0, hops: 0, empty: 0, fetch: 0, auth: 0 };
      byLane.set(lane, b);
    }
    b.calls += 1;
    if (r.ok === true) b.ok += 1;
    if (typeof r.latency_ms === 'number' && Number.isFinite(r.latency_ms)) b.lat.push(r.latency_ms);
    const e = r.error ?? '';
    if (e.startsWith('engine_fallback_') || e === 'engine_timeout') b.hops += 1;
    if (e === 'empty_stream_fallback') b.empty += 1;
    if (e === 'model_fetch' || e === 'model_fetch_empty') b.fetch += 1;
    if (r.status === 401 || r.status === 403 || r.status === 429) b.auth += 1;
  }
  return [...byLane.entries()]
    .map(([lane, b]) => {
      const sorted = [...b.lat].sort((x, y) => x - y);
      return {
        lane,
        calls: b.calls,
        okPct: b.calls ? Math.round((b.ok / b.calls) * 100) : 0,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        hops: b.hops,
        emptyStreams: b.empty,
        selfSearches: b.fetch,
        authErrors: b.auth,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}
