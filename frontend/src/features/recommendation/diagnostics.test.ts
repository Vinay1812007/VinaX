import { describe, expect, it } from 'vitest';
import type { DebugBatch } from '@/store/recsDebugStore';
import { makeSong } from '@/__fixtures__/songs';
import { pct, summarise } from './diagnostics';

const row = (id: string, over: { artist?: string; picker?: 'local' | 'ai'; title?: string } = {}) => ({
  position: 1,
  song: makeSong(id, { artist: over.artist ?? `Artist ${id}`, ...(over.title ? { title: over.title } : {}) }),
  finalScore: 1,
  source: 'related',
  components: [],
  picker: over.picker ?? ('local' as const),
});

/** The store holds batches NEWEST FIRST; these helpers build them that way. */
const batch = (ids: string[], over: Partial<DebugBatch> = {}): DebugBatch => ({
  at: 0,
  rows: ids.map((id) => row(id)),
  rejected: [],
  passedOver: [],
  ...over,
});

const trace = (over: Partial<NonNullable<DebugBatch['trace']>> = {}): DebugBatch['trace'] => ({
  mode: 'balanced',
  shape: 'steady',
  lock: 'telugu',
  languagePolicy: 'lock',
  discoveryShare: 0.2,
  intent: null,
  stages: { candidates: 50, admitted: 40, ranked: 30, sequenced: 20, validated: 10 },
  relaxed: [],
  repairs: 0,
  ...over,
});

describe('summarise — the repeat rates the 9.1 work exists to move', () => {
  it('is empty with nothing recorded', () => {
    const d = summarise([]);
    expect(d.repeats.batches).toBe(0);
    expect(d.sources).toEqual([]);
    expect(d.latency.samples).toBe(0);
  });

  it('measures overlap against the PREVIOUS batch, in the order they were heard', () => {
    // Newest first: b (second heard) then a (first heard).
    const d = summarise([batch(['x', 'y', 'c', 'd']), batch(['a', 'b', 'c', 'd'])]);
    // Of the second batch's 4 songs, 2 were in the first.
    expect(d.repeats.batchOverlap).toBeCloseTo(0.5, 5);
    expect(d.repeats.batches).toBe(2);
    expect(d.repeats.songs).toBe(8);
  });

  it('reports zero overlap for a single batch (nothing to compare with)', () => {
    expect(summarise([batch(['a', 'b'])]).repeats.batchOverlap).toBe(0);
  });

  it('counts a repeat across the whole session, not just the batch before', () => {
    const d = summarise([batch(['a']), batch(['z']), batch(['a'])]);
    // 'a' is heard twice across three batches of one song each.
    expect(d.repeats.sessionRepeat).toBeCloseTo(1 / 3, 5);
    // …but it never followed itself directly.
    expect(d.repeats.batchOverlap).toBe(0);
  });

  it('counts an alternate release as the same song', () => {
    const remix = batch([]);
    remix.rows = [row('b', { artist: 'Sai Kiran', title: 'Monica (2025 Remix)' })];
    const original = batch([]);
    original.rows = [row('a', { artist: 'Sai Kiran', title: 'Monica' })];
    expect(summarise([remix, original]).repeats.batchOverlap).toBe(1);
  });

  it('reports artist spread and the worst concentration', () => {
    const b = batch([]);
    b.rows = [row('1', { artist: 'A' }), row('2', { artist: 'A' }), row('3', { artist: 'A' }), row('4', { artist: 'B' })];
    const d = summarise([b]);
    expect(d.repeats.artistsPerBatch).toBe(2);
    expect(d.repeats.worstArtistShare).toBeCloseTo(0.75, 5);
  });
});

describe('summarise — where the candidates came from and what gave way', () => {
  it('sums candidate counts per source, strongest first', () => {
    const d = summarise([
      batch(['a'], { trace: trace({ sources: { related: 10, 'verified-trend': 4 } }) }),
      batch(['b'], { trace: trace({ sources: { related: 5, 'web-discovery': 2 } }) }),
    ]);
    expect(d.sources).toEqual([
      { source: 'related', count: 15 },
      { source: 'verified-trend', count: 4 },
      { source: 'web-discovery', count: 2 },
    ]);
  });

  it('counts fallback reasons, and records none when the AI was used', () => {
    const d = summarise([
      batch(['a'], { trace: trace({ fallback: 'ai_timeout' }) }),
      batch(['b'], { trace: trace({ fallback: 'ai_timeout' }) }),
      batch(['c'], { trace: trace({ fallback: null }) }),
    ]);
    expect(d.fallbacks).toEqual([{ reason: 'ai_timeout', count: 2 }]);
  });

  it('counts relaxations and hard-filter rejections separately', () => {
    const d = summarise([
      batch(['a'], {
        trace: trace({ relaxed: ['artist-cap', 'discovery-share'] }),
        rejected: [
          { song: makeSong('r1'), reason: 'recently-played', stage: 'filter' },
          { song: makeSong('r2'), reason: 'recently-played', stage: 'filter' },
          { song: makeSong('r3'), reason: 'snoozed', stage: 'filter' },
        ],
      }),
    ]);
    expect(d.relaxed).toEqual([
      { rule: 'artist-cap', count: 1 },
      { rule: 'discovery-share', count: 1 },
    ]);
    expect(d.rejections).toEqual([
      { reason: 'recently-played', count: 2 },
      { reason: 'snoozed', count: 1 },
    ]);
  });

  it('reports latency percentiles over the batches that recorded one', () => {
    const d = summarise([
      batch(['a'], { trace: trace({ latencyMs: 100 }) }),
      batch(['b'], { trace: trace({ latencyMs: 300 }) }),
      batch(['c'], { trace: trace({ latencyMs: 200 }) }),
      batch(['d'], { trace: trace({}) }), // no latency recorded
    ]);
    expect(d.latency.samples).toBe(3);
    expect(d.latency.max).toBe(300);
    expect(d.latency.p50).toBe(200);
  });

  it('splits who chose each order', () => {
    const b = batch([]);
    b.rows = [row('1', { picker: 'ai' }), row('2', { picker: 'ai' }), row('3', { picker: 'local' })];
    expect(summarise([b]).pickers).toEqual({ local: 1, ai: 2 });
  });

  it('survives a batch with no trace at all', () => {
    expect(() => summarise([batch(['a'])])).not.toThrow();
    expect(summarise([batch(['a'])]).sources).toEqual([]);
  });
});

describe('pct', () => {
  it('reads a share as a whole percentage', () => {
    expect(pct(0)).toBe('0%');
    expect(pct(0.666)).toBe('67%');
    expect(pct(1)).toBe('100%');
  });
});
