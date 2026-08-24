import { describe, expect, it } from 'vitest';
import { injectExplore } from './mixes';
import type { Candidate, ScoredCandidate } from './types';
import type { Song } from '../../types';

const sc = (id: string, source: Candidate['source'] = 'related'): ScoredCandidate => ({
  candidate: { song: { id, title: id, artists: [] } as unknown as Song, source },
  score: 1,
  reasons: [],
});

describe('injectExplore (A4)', () => {
  const shelf = Array.from({ length: 20 }, (_, i) => sc(`t${i}`));
  const pool = [sc('x1', 'explore'), sc('x2', 'explore'), sc('x3', 'explore'), sc('x4', 'explore')];

  it('swaps the tail ~15% for explore picks and reports them', () => {
    const { out, injected } = injectExplore(shelf, pool);
    expect(out).toHaveLength(20);
    expect(injected.map((s) => s.candidate.song.id)).toEqual(['x1', 'x2', 'x3']); // floor(20*0.15)
    expect(out.slice(-3).map((s) => s.candidate.song.id)).toEqual(['x1', 'x2', 'x3']);
    // Taste order up front is untouched.
    expect(out[0].candidate.song.id).toBe('t0');
  });

  it('never injects more than the pool holds', () => {
    const { out, injected } = injectExplore(shelf, pool.slice(0, 1));
    expect(injected).toHaveLength(1);
    expect(out).toHaveLength(20);
  });

  it('is a no-op for an empty pool or a shelf too small for a slot', () => {
    expect(injectExplore(shelf, []).out).toBe(shelf);
    const tiny = shelf.slice(0, 5); // floor(5*0.15) = 0
    expect(injectExplore(tiny, pool).out).toBe(tiny);
  });
});
