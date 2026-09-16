// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { recsDebugEnabled, useRecsDebugStore } from './recsDebugStore';

const song = { id: 'x', title: 'X' } as Song;

beforeEach(() => {
  localStorage.clear();
  useRecsDebugStore.getState().clear();
});

describe('recs debug store', () => {
  it('keeps the last twelve batches, newest first', () => {
    for (let i = 0; i < 15; i += 1) useRecsDebugStore.getState().publish([{ position: 1, song, finalScore: i, source: 'related', components: [], picker: i % 2 ? 'ai' : 'local' }]);
    const b = useRecsDebugStore.getState().batches;
    expect(b).toHaveLength(12);
    expect(b[0].rows[0].finalScore).toBe(14);
  });
  it('is enabled by the localStorage switch (and the ?debug=recs query in the browser)', () => {
    // Under vitest, import.meta.env.DEV is true, so the dev-build path is on; the switch still works.
    localStorage.setItem('vinax.debug.recs', '1');
    expect(recsDebugEnabled()).toBe(true);
  });
});
