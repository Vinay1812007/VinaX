// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { DECAY, EVENT_WEIGHTS, MAX_AFFINITY } from './eventWeights';
import {
  applyTimeDecay,
  bumpArtist,
  bumpDay,
  bumpEnergyPref,
  bumpLanguage,
  bumpSong,
  createEmptyProfile,
  dayOfWeekWeight,
  getDecayedAffinity,
  preferredEnergy,
  songWeight,
} from './profile';

const DAY = 86_400_000;

describe('event weights', () => {
  it('are the documented defaults and stay configurable in one place', () => {
    expect(EVENT_WEIGHTS).toMatchObject({ PLAY: 1, COMPLETE: 2, FAVORITE: 3, QUEUE_ADD: 0.5, SKIP: -0.75 });
    expect(DECAY).toEqual({ positiveHalfLifeDays: 14, skipHalfLifeDays: 30 });
  });
  it('no single event can dominate: affinity is capped', () => {
    const p = createEmptyProfile(0);
    for (let i = 0; i < 100; i += 1) bumpArtist(p, 'a1', 'Artist', EVENT_WEIGHTS.FAVORITE, 'play', 0);
    expect(p.artists.a1.score).toBe(MAX_AFFINITY);
    for (let i = 0; i < 200; i += 1) bumpLanguage(p, 'telugu', EVENT_WEIGHTS.COMPLETE, 'complete', 0);
    expect(p.languages.telugu.score).toBe(MAX_AFFINITY);
    bumpSong(p, 's', EVENT_WEIGHTS.SKIP, 'skip', 0);
    expect(p.songs?.s.score).toBe(0); // never negative
  });
});

describe('time decay', () => {
  it('halves positive scores every 14 days and skips every 30, and never runs twice inside six hours', () => {
    const p = createEmptyProfile(0);
    bumpArtist(p, 'a1', 'Artist', 8, 'play', 0);
    p.artists.a1.skips = 4;
    bumpSong(p, 's1', 8, 'play', 0);
    applyTimeDecay(p, 14 * DAY);
    expect(p.artists.a1.score).toBeCloseTo(4);
    expect(p.songs?.s1.score).toBeCloseTo(4);
    expect(p.artists.a1.skips).toBeCloseTo(4 * Math.pow(0.5, 14 / 30));
    applyTimeDecay(p, 14 * DAY + 3_600_000);
    expect(p.artists.a1.score).toBeCloseTo(4); // idempotent inside the window
    applyTimeDecay(p, 44 * DAY);
    expect(p.artists.a1.skips).toBeCloseTo(4 * Math.pow(0.5, 44 / 30));
  });
  it('getDecayedAffinity is pure and per-item, favouring recent behaviour without forgetting', () => {
    const a = { score: 10, plays: 5, completes: 3, skips: 0, lastTs: 0 };
    expect(getDecayedAffinity(a, 0)).toBe(10);
    expect(getDecayedAffinity(a, 14 * DAY)).toBeCloseTo(5);
    expect(getDecayedAffinity(a, 140 * DAY)).toBeGreaterThan(0);
    expect(getDecayedAffinity(undefined)).toBe(0);
    expect(a.score).toBe(10);
  });
});

describe('song, weekday and energy signals', () => {
  it('song affinity ranks songs relative to the strongest and caps the table at 300', () => {
    const p = createEmptyProfile(0);
    bumpSong(p, 'a', 4, 'play', 1);
    bumpSong(p, 'b', 2, 'play', 2);
    expect(songWeight(p, 'a')).toBe(1);
    expect(songWeight(p, 'b')).toBe(0.5);
    expect(songWeight(p, 'zzz')).toBe(0);
    for (let i = 0; i < 320; i += 1) bumpSong(p, `x${i}`, 1, 'play', 10 + i);
    expect(Object.keys(p.songs ?? {})).toHaveLength(300);
    expect(p.songs?.a).toBeUndefined(); // least recent dropped
  });
  it('weekday rhythm and energy preference come from real plays only', () => {
    const p = createEmptyProfile(0);
    expect(dayOfWeekWeight(p, 6)).toBe(0);
    bumpDay(p, 6);
    bumpDay(p, 6);
    bumpDay(p, 1);
    expect(dayOfWeekWeight(p, 6)).toBe(1);
    expect(dayOfWeekWeight(p, 1)).toBe(0.5);
    expect(preferredEnergy(p)).toBeNull();
    for (let i = 0; i < 5; i += 1) bumpEnergyPref(p, 0.8);
    expect(preferredEnergy(p)).toBeCloseTo(0.8);
    const song = { title: 'x' } as Song;
    expect(song.title).toBe('x');
  });
});
