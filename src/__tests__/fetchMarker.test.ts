import { describe, expect, it } from 'vitest';
import { probeFetchMarker } from '../../worker/functions/_lib/fetchMarker';

/** B3 — the [[FETCH: …]] probe must be exact about waiting vs releasing:
 *  a wrong 'no' leaks tool syntax to the client, a wrong 'wait' stalls the
 *  stream. These boundaries are the whole game. */
describe('probeFetchMarker (B3)', () => {
  it('captures a complete marker and trims quotes', () => {
    expect(probeFetchMarker('[[FETCH: ipl 2026 final result]]')).toEqual({
      state: 'marker',
      q: 'ipl 2026 final result',
      rest: '',
    });
    expect(probeFetchMarker('[[FETCH: "gold price today"]] and more')).toEqual({
      state: 'marker',
      q: 'gold price today',
      rest: 'and more',
    });
  });

  it('waits while the lead could still become (or complete) a marker', () => {
    expect(probeFetchMarker('[[')).toEqual({ state: 'wait' });
    expect(probeFetchMarker('[[FETC')).toEqual({ state: 'wait' });
    expect(probeFetchMarker('[[FETCH: unfinished query')).toEqual({ state: 'wait' });
  });

  it('releases ordinary text immediately', () => {
    expect(probeFetchMarker('Here is your answer')).toEqual({ state: 'no' });
    expect(probeFetchMarker('[citation needed]')).toEqual({ state: 'no' });
    expect(probeFetchMarker('[[bracketed aside]] text')).toEqual({ state: 'no' });
  });

  it('gives up on an unclosed pseudo-marker past the cap, and on empty queries', () => {
    expect(probeFetchMarker('[[FETCH: ' + 'x'.repeat(500))).toEqual({ state: 'no' });
    expect(probeFetchMarker('[[FETCH:]]')).toEqual({ state: 'no' });
    expect(probeFetchMarker('[[FETCH:  " " ]]')).toEqual({ state: 'no' });
  });

  it('caps a runaway query at 300 chars', () => {
    const r = probeFetchMarker(`[[FETCH: ${'q'.repeat(350)}]]`);
    expect(r.state).toBe('marker');
    if (r.state === 'marker') expect(r.q).toHaveLength(300);
  });
});
