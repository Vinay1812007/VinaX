/**
 * Songs the music AI names become catalogue songs only on a confident match:
 * the title matches and the artist is among the song's artists. Anything
 * else is dropped, so the AI can never put a wrong or made-up song on screen.
 */
import { describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import type { HistoryEntry } from '@/types';
import { bestMatch, recentPlays, resolvePicks } from './suggest';

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

describe('recentPlays', () => {
  it('lists the last songs the listener let play, newest first, without skips or repeats', () => {
    const e = (song: ReturnType<typeof makeSong>, skipped = false): HistoryEntry => ({ song, ts: Date.now(), completed: !skipped, playedMs: skipped ? 2_000 : 200_000, ...(skipped ? { skipped: true } : {}) } as unknown as HistoryEntry);
    const plays = recentPlays([e(other), e(cover, true), e(samaja), e(other)], 10);
    expect(plays.map((p) => p.artist)).toEqual(['Armaan Malik', 'Sid Sriram']);
  });
});
