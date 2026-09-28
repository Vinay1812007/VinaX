// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import { lastSeedContinuation, PROVEN_COOLDOWN_MS, provenPicks, recordAutoOutcome, rememberSeedContinuation, resetRecMemory, SEED_MEMORY_SIZE } from './recMemory';
import { autoOutcomeFor } from './transitionTracker';

/** 8.2.0 — the engine's memory of its own automatic picks, and of what it served after each seed. */
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

beforeEach(() => {
  localStorage.clear();
  resetRecMemory();
});

describe('proven picks', () => {
  it('keeps songs with more successes than misses, strongest first, one entry per identity', () => {
    const a = makeSong('a', { artist: 'A' });
    const b = makeSong('b', { artist: 'B' });
    const c = makeSong('c', { artist: 'C' });
    recordAutoOutcome(a, 'success', NOW - 3000);
    recordAutoOutcome(makeSong('a-remaster', { title: 'Song a (Remastered)', artist: 'A' }), 'success', NOW - 2000);
    recordAutoOutcome(b, 'success', NOW - 1000);
    recordAutoOutcome(c, 'success', NOW - 1000);
    recordAutoOutcome(c, 'miss', NOW - 500);
    const picks = provenPicks({ now: NOW });
    expect(picks.map((p) => p.net)).toEqual([2, 1]);
    expect(picks[1].song.id).toBe('b');
    expect(picks.some((p) => p.song.artists[0].name === 'C')).toBe(false);
  });

  it('offers a song again as itself only after the cooldown', () => {
    recordAutoOutcome(makeSong('old', { artist: 'O' }), 'success', NOW - PROVEN_COOLDOWN_MS - DAY);
    recordAutoOutcome(makeSong('new', { artist: 'N' }), 'success', NOW - DAY);
    expect(provenPicks({ now: NOW, cooledOnly: true }).map((p) => p.song.id)).toEqual(['old']);
    expect(provenPicks({ now: NOW }).map((p) => p.song.id).sort()).toEqual(['new', 'old']);
  });

  it('forgets after two months and survives garbage in storage', () => {
    recordAutoOutcome(makeSong('x', { artist: 'X' }), 'success', NOW - 61 * DAY);
    expect(provenPicks({ now: NOW })).toEqual([]);
    localStorage.setItem('vinax.recs.outcomes.v1', '{"not":"a list"}');
    expect(provenPicks({ now: NOW })).toEqual([]);
    localStorage.setItem('vinax.recs.outcomes.v1', '[{"k":1},null,{"k":"y","song":{"id":"y"},"ok":1,"bad":0,"at":0}]');
    expect(provenPicks({ now: NOW })).toEqual([]);
  });
});

describe('per-seed memory', () => {
  it('remembers the opening of the last accepted continuation after a seed, for a while', () => {
    const seed = makeSong('seed', { artist: 'S' });
    const songs = Array.from({ length: 8 }, (_, i) => makeSong(`n${i}`, { artist: `N${i}` }));
    rememberSeedContinuation(seed, songs, NOW);
    expect([...lastSeedContinuation(seed, NOW + 1000)]).toEqual(songs.slice(0, SEED_MEMORY_SIZE).map((s) => s.id));
    // Another cut of the same song is the same seed.
    expect(lastSeedContinuation(makeSong('seed-2', { title: 'Song seed (Remastered)', artist: 'S' }), NOW).size).toBe(SEED_MEMORY_SIZE);
    expect(lastSeedContinuation(makeSong('other', { artist: 'S' }), NOW).size).toBe(0);
    expect(lastSeedContinuation(seed, NOW + 13 * 3_600_000).size).toBe(0);
  });
});

describe('autoOutcomeFor', () => {
  it('reads the playback session thresholds', () => {
    expect(autoOutcomeFor(200, 210, 'ended', false)).toBe('success');
    expect(autoOutcomeFor(5, 210, 'manual-skip', false)).toBe('miss');
    expect(autoOutcomeFor(50, 210, 'manual-skip', false)).toBe('miss');
    expect(autoOutcomeFor(150, 210, 'manual-skip', false)).toBeNull();
    expect(autoOutcomeFor(5, 210, 'manual-skip', true)).toBe('success');
    expect(autoOutcomeFor(200, 210, 'failed', true)).toBeNull();
    expect(autoOutcomeFor(100, 210, 'replaced', false)).toBeNull();
  });
});
