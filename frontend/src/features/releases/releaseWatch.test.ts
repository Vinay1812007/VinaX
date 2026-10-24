import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { findNew } from './releaseWatch';

const s = (id: string, year: string): Song => ({ id, year } as unknown as Song);

describe('15.0 — release alerts', () => {
  it('the first look only seeds: nothing is new', () => {
    expect(findNew([s('a', '2026')], undefined, 2026)).toEqual([]);
  });
  it('a song from this year that was not seen before is new; older or seen ones are not', () => {
    const now = [s('a', '2026'), s('b', '2026'), s('c', '2019')];
    expect(findNew(now, ['a'], 2026).map((x) => x.id)).toEqual(['b']);
  });
});
