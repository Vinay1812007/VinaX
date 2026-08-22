import { describe, expect, it } from 'vitest';
import { aggregateLaneHealth, percentile, type AiEventRow } from '../../worker/functions/_lib/laneHealth';

const row = (over: Partial<AiEventRow>): AiEventRow => ({
  model: 'gpt-oss @chat',
  ok: true,
  error: null,
  latency_ms: 1000,
  ...over,
});

describe('percentile (B11) — nearest rank', () => {
  it('handles the classic boundaries', () => {
    const s = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(s, 50)).toBe(500);
    expect(percentile(s, 95)).toBe(1000);
    expect(percentile(s, 99)).toBe(1000);
    expect(percentile([420], 50)).toBe(420);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('aggregateLaneHealth (B11)', () => {
  it('groups by the @role lane suffix and counts error classes', () => {
    const rows: AiEventRow[] = [
      row({ latency_ms: 800 }),
      row({ latency_ms: 1200 }),
      row({ ok: false, error: 'engine_timeout', latency_ms: 18000 }),
      row({ ok: false, error: 'engine_fallback_400', latency_ms: 300 }),
      row({ ok: false, error: 'empty_stream_fallback', latency_ms: 2000 }),
      row({ ok: true, error: 'model_fetch', latency_ms: 5000 }),
      row({ ok: false, status: 429, error: 'http_429', latency_ms: 100 }),
      row({ model: 'llama @scholar', latency_ms: 150 }),
    ];
    const out = aggregateLaneHealth(rows);
    expect(out[0].lane).toBe('chat'); // most calls first
    expect(out[0].calls).toBe(7);
    expect(out[0].okPct).toBe(43);
    expect(out[0].hops).toBe(2);
    expect(out[0].authErrors).toBe(1); // E5 — the 429 row
    expect(out[0].emptyStreams).toBe(1);
    expect(out[0].selfSearches).toBe(1);
    expect(out[1]).toMatchObject({ lane: 'scholar', calls: 1, okPct: 100, p50: 150 });
  });

  it('survives malformed rows (null model, missing latency)', () => {
    const out = aggregateLaneHealth([
      row({ model: null, latency_ms: null }),
      row({ model: 'weird-no-role', latency_ms: 250 }),
    ]);
    const unknown = out.find((l) => l.lane === 'unknown');
    expect(unknown?.calls).toBe(2);
    expect(unknown?.p50).toBe(250); // the null latency simply isn't sampled
  });
});
