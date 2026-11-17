/**
 * Songs VinaX AI names become catalogue songs only on a confident match:
 * the title matches and the artist is among the song's artists. Anything
 * else is dropped, so the AI can never put a wrong or made-up song on screen.
 */
import { describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import { bestMatch, createSongResolver, orderedFeed, resolvePicks } from './suggest';

const samaja = makeSong('s1', { title: 'Samajavaragamana (From "Ala Vaikunthapurramuloo")', artist: 'Sid Sriram' });
const cover = makeSong('s2', { title: 'Samajavaragamana', artist: 'Some Cover Band' });
const other = makeSong('s3', { title: 'Butta Bomma', artist: 'Armaan Malik' });

describe('bestMatch', () => {
  it('needs the title and the artist to match', () => {
    expect(bestMatch([cover, samaja, other], { title: 'Samajavaragamana', artist: 'Sid Sriram' })?.id).toBe('s1');
    expect(bestMatch([cover, other], { title: 'Samajavaragamana', artist: 'Sid Sriram' })).toBeNull();
    expect(bestMatch([samaja], { title: 'A Song That Does Not Exist', artist: 'Sid Sriram' })).toBeNull();
  });
});

describe('resolvePicks', () => {
  it('keeps the picks’ order, drops misses and failures, and keeps a song once', async () => {
    const search = vi.fn(async (q: string) => {
      if (q.startsWith('Broken')) throw new Error('offline');
      if (q.startsWith('Butta')) return [other];
      if (q.startsWith('Samaja')) return [samaja];
      return [];
    });
    const out = await resolvePicks([
      { title: 'Butta Bomma', artist: 'Armaan Malik', reason: 'Bouncy' },
      { title: 'Made Up Song', artist: 'Nobody' },
      { title: 'Broken', artist: 'X' },
      { title: 'Samajavaragamana', artist: 'Sid Sriram' },
      { title: 'Samajavaragamana', artist: 'Sid Sriram' },
    ], { search, concurrency: 2 });
    expect(out.map((x) => x.song.id)).toEqual(['s3', 's1']);
    expect(out[0].pick.reason).toBe('Bouncy');
  });
});

describe('createSongResolver', () => {
  it('keeps answers, shares a running search and does not keep failures', async () => {
    let fail = true;
    const search = vi.fn(async (q: string) => {
      if (q.startsWith('Broken') && fail) throw new Error('offline');
      if (q.startsWith('Broken')) return [makeSong('b1', { title: 'Broken', artist: 'X' })];
      if (q.startsWith('Butta')) return [other];
      return [];
    });
    const r = createSongResolver({ search });
    const refs = [
      { title: 'Butta Bomma', artist: 'Armaan Malik' },
      { title: 'Butta Bomma', artist: 'Armaan Malik' },
      { title: 'Made Up Song', artist: 'Nobody' },
      { title: 'Broken', artist: 'X' },
    ];
    const seen: number[] = [];
    const first = await r.resolve(refs, (i) => seen.push(i));
    expect(first.map((s) => (s === undefined ? 'failed' : s?.id ?? null))).toEqual(['s3', 's3', null, 'failed']);
    expect(seen.sort()).toEqual([0, 1, 2, 3]);
    expect(search).toHaveBeenCalledTimes(3); // the same pair twice is one search
    expect(r.peek(refs[0])?.id).toBe('s3');
    expect(r.peek(refs[2])).toBeNull();
    expect(r.peek(refs[3])).toBeUndefined();
    fail = false;
    const again = await r.resolve(refs);
    expect(again.map((s) => s?.id ?? null)).toEqual(['s3', 's3', null, 'b1']);
    expect(search).toHaveBeenCalledTimes(4); // only the failed one was asked again
  });

  it('runs at most four searches at once', async () => {
    let running = 0;
    let most = 0;
    const search = vi.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 1));
      running -= 1;
      return [];
    });
    await createSongResolver({ search }).resolve(Array.from({ length: 12 }, (_, i) => ({ title: `Song ${i}`, artist: 'A' })));
    expect(search).toHaveBeenCalledTimes(12);
    expect(most).toBe(4);
  });

  it('keeps the limit and shares searches across two presses at once, starting them in order', async () => {
    let running = 0;
    let most = 0;
    const asked: string[] = [];
    const search = vi.fn(async (q: string) => {
      asked.push(q);
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 1));
      running -= 1;
      return [];
    });
    const r = createSongResolver({ search });
    const refs = Array.from({ length: 10 }, (_, i) => ({ title: `Tune ${i}`, artist: 'B' }));
    await Promise.all([r.resolve(refs), r.resolve([...refs].reverse())]);
    expect(search).toHaveBeenCalledTimes(10);
    expect(most).toBe(4);
    expect(asked.slice(0, 4)).toEqual(['Tune 0 B', 'Tune 1 B', 'Tune 2 B', 'Tune 3 B']);
  });

  it('searches nothing once the signal is aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const search = vi.fn(async () => [other]);
    const r = createSongResolver({ search, signal: ctrl.signal });
    expect(await r.resolve([{ title: 'Butta Bomma', artist: 'Armaan Malik' }])).toEqual([undefined]);
    expect(search).not.toHaveBeenCalled();
  });
});

describe('orderedFeed', () => {
  it('hands songs out in list order, skips misses and repeats', () => {
    const a = makeSong('a');
    const b = makeSong('b');
    const c = makeSong('c');
    const out: string[][] = [];
    const push = orderedFeed(5, (songs) => out.push(songs.map((s) => s.id)));
    push(2, b);
    push(1, null);
    expect(out).toEqual([]);
    push(0, a);
    expect(out).toEqual([['a', 'b']]);
    push(4, c);
    push(3, a);
    expect(out).toEqual([['a', 'b'], ['c']]);
    push(0, c); // a pair settles once
    expect(out).toHaveLength(2);
  });
});
