/**
 * "Most played on VinaX this week": the route's rows are parsed strictly,
 * and the songs are looked up in the catalogue in chart order, a few at a
 * time, leaving out what the catalogue cannot find.
 */
import { describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';

vi.mock('@/services/api', () => ({ getSong: vi.fn() }));

import { parseChart, resolveChartSongs, type ChartRow } from './vinaxChart';

const rows = (n: number): ChartRow[] => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, title: `Song ${i + 1}`, artist: 'A', image: null, rank: i + 1 }));

describe('parseChart', () => {
  it('keeps well-formed rows in rank order and only https art', () => {
    expect(parseChart({
      songs: [
        { id: 'b', title: 'B', artist: 'Two', image: 'http://insecure/b.jpg', rank: 2 },
        { id: '', title: 'No id', rank: 3 },
        { id: 'c', rank: 4 },
        null,
        { id: 'a', title: 'A', image: 'https://img.test/a.jpg', rank: 1 },
      ],
    })).toEqual([
      { id: 'a', title: 'A', artist: '', image: 'https://img.test/a.jpg', rank: 1 },
      { id: 'b', title: 'B', artist: 'Two', image: null, rank: 2 },
    ]);
  });

  it('answers no rows for anything else', () => {
    expect(parseChart(null)).toEqual([]);
    expect(parseChart({ songs: 'x' })).toEqual([]);
    expect(parseChart('nope')).toEqual([]);
  });
});

describe('resolveChartSongs', () => {
  it('looks up only the first ones asked for, keeps chart order and drops misses', async () => {
    let running = 0;
    let most = 0;
    const lookup = vi.fn(async (id: string) => {
      running += 1;
      most = Math.max(most, running);
      // Later rows answer first: the order must still be the chart's.
      await new Promise((r) => setTimeout(r, 30 - Number(id.slice(1))));
      running -= 1;
      if (id === 's3') throw new Error('not found');
      return makeSong(id);
    });
    const songs = await resolveChartSongs(rows(25), lookup, 20);
    expect(lookup).toHaveBeenCalledTimes(20);
    expect(most).toBeLessThanOrEqual(4);
    expect(songs.map((s) => s.id)).toEqual(rows(20).map((r) => r.id).filter((id) => id !== 's3'));
  });

  it('stops looking up once the request is aborted', async () => {
    const ctrl = new AbortController();
    const lookup = vi.fn(async (id: string) => {
      ctrl.abort();
      return makeSong(id);
    });
    await resolveChartSongs(rows(20), lookup, 20, ctrl.signal);
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
