// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emitPlaybackEvent, type PlaybackEvent } from '@/services/playback/session';
import { makeSong } from '@/__fixtures__/songs';
import { initTransitionTracker, outcomeFor } from './transitionTracker';
import { provenPicks, resetRecMemory } from './recMemory';

describe('outcomeFor', () => {
  it('judges a play by how much of it was heard', () => {
    expect(outcomeFor(180, 200)).toBe('completed');
    expect(outcomeFor(140, 200)).toBe('completed');
    expect(outcomeFor(20, 200)).toBe('skipped');
    expect(outcomeFor(100, 200)).toBeNull();
    expect(outcomeFor(50, 0)).toBeNull();
  });
});

describe('8.2.0 — the memory of automatic picks', () => {
  let stop: () => void = () => undefined;
  beforeEach(() => {
    localStorage.clear();
    resetRecMemory();
    stop = initTransitionTracker();
  });
  afterEach(() => stop());

  const end = (id: string, run: string, heardSec: number, reason: 'ended' | 'manual-skip', auto: boolean): PlaybackEvent => ({
    kind: 'end',
    instanceId: run,
    song: makeSong(id, { artist: `Artist ${id}` }),
    from: null,
    heardSec,
    durationSec: 210,
    reason,
    run: { id: run } as never,
    auto: auto ? { alg: 'test', picker: 'local', pos: 0, batch: 1 } : null,
  });

  it('remembers automatic picks that were finished, once per run, and ignores songs the listener chose', () => {
    emitPlaybackEvent(end('a', 'r1', 205, 'ended', true));
    emitPlaybackEvent(end('a', 'r1', 205, 'ended', true)); // a repeat-one loop of the same run
    emitPlaybackEvent(end('b', 'r2', 205, 'ended', false));
    emitPlaybackEvent(end('c', 'r3', 4, 'manual-skip', true));
    const picks = provenPicks();
    expect(picks.map((p) => [p.song.id, p.net])).toEqual([['a', 1]]);
  });
});
