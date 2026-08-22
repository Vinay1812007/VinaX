/**
 * P2-30 — artist/playlist search pagination. The tabs were hard-capped at 20;
 * now they page like songs/albums. The critical guard: mirrors that IGNORE
 * the page param serve page 1 forever, which must read as end-of-results
 * instead of an infinite loop of identical fetches.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { flattenPages, pageAddedNothing } from '../features/search/useInfiniteSongs';

const items = (...ids: string[]) => ids.map((id) => ({ id }));

describe('pageAddedNothing (mirror-ignores-paging guard)', () => {
  it('false while pages contribute fresh ids', () => {
    expect(pageAddedNothing(items('a', 'b'), [items('a', 'b')])).toBe(false);
    expect(pageAddedNothing(items('c', 'd'), [items('a', 'b'), items('c', 'd')])).toBe(false);
    // Partial overlap still counts as progress.
    expect(pageAddedNothing(items('b', 'c'), [items('a', 'b'), items('b', 'c')])).toBe(false);
  });

  it('true when the mirror serves the same page again (stop condition)', () => {
    const p1 = items('a', 'b', 'c');
    expect(pageAddedNothing(items('a', 'b', 'c'), [p1, items('a', 'b', 'c')])).toBe(true);
  });

  it('an empty page adds nothing', () => {
    expect(pageAddedNothing([], [items('a'), []])).toBe(true);
  });
});

describe('flattenPages', () => {
  it('de-dupes by id across pages, preserving first-seen order', () => {
    const out = flattenPages([items('a', 'b'), items('b', 'c'), items('a', 'd')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles undefined (no data yet)', () => {
    expect(flattenPages(undefined)).toEqual([]);
  });
});
