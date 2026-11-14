import { describe, expect, it } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import { rotateFresh, seededShuffle } from './freshRotation';

const list = Array.from({ length: 12 }, (_, i) => makeSong(`s${i}`, { title: `Song ${i}`, artist: `Artist ${i}` }));

describe('freshRotation', () => {
  it('shuffles the same way for the same salt and differently for another', () => {
    expect(seededShuffle(list, 7)).toEqual(seededShuffle(list, 7));
    expect(seededShuffle(list, 7)).not.toEqual(seededShuffle(list, 8));
    expect(seededShuffle(list, 7).map((s) => s.id).sort()).toEqual(list.map((s) => s.id).sort());
  });

  it('puts songs met lately at the back and never drops one', () => {
    const met = new Set(['s0', 's1']);
    const out = rotateFresh(list, 3, (s) => met.has(s.id));
    expect(out).toHaveLength(list.length);
    expect(out.slice(-2).map((s) => s.id).sort()).toEqual(['s0', 's1']);
  });

  it('drops a second copy of the same song', () => {
    expect(rotateFresh([...list, list[3]], 1, () => false)).toHaveLength(list.length);
  });
});
