// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { arcErrorOf, arcTarget, sequenceSongs, songEnergy } from './sequencer';
import { recordTransition, resetTransitionMemory, transitionScore } from './transitions';

const song = (id: string, title: string, artist: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: { id: `al-${id}`, name: `Album ${id}` }, images: [], audio: [],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: null, ...extra,
});

beforeEach(() => resetTransitionMemory());

describe('songEnergy and arcTarget', () => {
  it('uses the classifier energy when present, else the mood estimate', () => {
    expect(songEnergy(song('a', 'x', 'y', { energy: 0.9 }))).toBeCloseTo(0.9);
    expect(songEnergy(song('b', 'party blast', 'y'))).toBeGreaterThan(songEnergy(song('c', 'sad tears', 'y')));
  });
  it('shapes move the target the way their names say', () => {
    expect(arcTarget('build', 9, 10, 0.3)).toBeGreaterThan(arcTarget('build', 0, 10, 0.3));
    expect(arcTarget('wind-down', 9, 10, 0.7)).toBeLessThan(arcTarget('wind-down', 0, 10, 0.7));
    expect(arcTarget('lift', 0, 10, 0.3)).toBeGreaterThan(0.3);
    const steady = Array.from({ length: 10 }, (_, i) => arcTarget('steady', i, 10, 0.5));
    expect(Math.max(...steady)).toBeGreaterThan(steady[0]);
    expect(steady[9]).toBeLessThanOrEqual(steady[6]);
  });
});

describe('sequenceSongs', () => {
  const pool = [
    song('1', 'Soft melody', 'A', { energy: 0.3 }),
    song('2', 'Party blast', 'B', { energy: 0.9 }),
    song('3', 'Calm night', 'A', { energy: 0.25 }),
    song('4', 'Dance mass', 'C', { energy: 0.85 }),
    song('5', 'Mid tempo', 'D', { energy: 0.55 }),
    song('6', 'Another mid', 'E', { energy: 0.5 }),
  ];

  it('never puts the same lead artist back to back when it can avoid it', () => {
    const r = sequenceSongs([song('x1', 'a', 'Same', { energy: 0.5 }), song('x2', 'b', 'Same', { energy: 0.5 }), song('x3', 'c', 'Other', { energy: 0.5 }), song('x4', 'd', 'Same', { energy: 0.5 })]);
    const artists = r.songs.map((s) => s.song.artists[0].name);
    for (let i = 1; i < artists.length; i += 1) if (artists[i] === artists[i - 1]) expect(i).toBeGreaterThan(2); // only forced at the very end
    expect(artists.slice(0, 3)).toEqual(['Same', 'Other', 'Same']);
  });

  it('follows the requested arc: build climbs, wind-down descends', () => {
    // limit < pool so the arc can CHOOSE (a full-pool sequence must place the leftovers somewhere).
    const build = sequenceSongs(pool, { shape: 'build', limit: 4, seed: song('s', 'seed', 'Z', { energy: 0.2 }) });
    const e = build.songs.map((s) => s.energy);
    expect(e[e.length - 1]).toBeGreaterThan(e[0]);
    const down = sequenceSongs(pool, { shape: 'wind-down', limit: 4, seed: song('s', 'seed', 'Z', { energy: 0.9 }) });
    const d = down.songs.map((s) => s.energy);
    expect(d[d.length - 1]).toBeLessThan(d[0]);
    expect(build.arcError).toBeLessThan(0.35);
  });

  it('honours a duration budget and a language lock', () => {
    const r = sequenceSongs(pool, { durationSec: 600 });
    expect(r.totalSec).toBeGreaterThanOrEqual(600);
    expect(r.songs.length).toBe(3);
    const locked = sequenceSongs([...pool, song('h', 'Hindi one', 'H', { language: 'hindi' })], { language: 'telugu' });
    expect(locked.songs.some((s) => s.song.id === 'h')).toBe(false);
  });

  it('caps discovery slots and prefers sure picks on lift', () => {
    const r = sequenceSongs(pool, { discovery: 0.2, discoveryIds: new Set(['2', '4', '5']), limit: 4 });
    expect(r.songs.filter((s) => ['2', '4', '5'].includes(s.song.id)).length).toBeLessThanOrEqual(1);
    // When only discovery songs are left, they are used rather than leaving the queue short.
    const forced = sequenceSongs(pool, { discovery: 0, discoveryIds: new Set(['1', '2', '3', '4', '5', '6']), limit: 3 });
    expect(forced.songs).toHaveLength(3);
    const lift = sequenceSongs(pool, { shape: 'lift', sureIds: new Set(['6']), seed: song('s', 'seed', 'Z', { energy: 0.5 }) });
    expect(lift.songs[0].song.id).toBe('6');
    expect(lift.songs[0].why).toMatch(/sure favourite/);
  });

  it('learns from transition memory: an accepted hand-off is preferred, a rejected one avoided', () => {
    const prev = song('p', 'Previous', 'P', { energy: 0.5 });
    const good = song('g', 'Good next', 'G', { energy: 0.5 });
    const bad = song('b', 'Bad next', 'Bb', { energy: 0.5 });
    for (let i = 0; i < 3; i += 1) {
      recordTransition(prev, good, 'completed');
      recordTransition(prev, bad, 'skipped');
    }
    expect(transitionScore(prev, good)).toBeGreaterThan(0.3);
    expect(transitionScore(prev, bad)).toBeLessThan(-0.3);
    const r = sequenceSongs([bad, good], { seed: prev });
    expect(r.songs[0].song.id).toBe('g');
    expect(r.songs[0].why).toMatch(/finished before/);
  });

  it('is deterministic and skips the seed and duplicates', () => {
    const a = sequenceSongs([...pool, pool[0]], { seed: pool[1] });
    const b = sequenceSongs([...pool, pool[0]], { seed: pool[1] });
    expect(a.songs.map((s) => s.song.id)).toEqual(b.songs.map((s) => s.song.id));
    expect(a.songs.some((s) => s.song.id === '2')).toBe(false);
    expect(new Set(a.songs.map((s) => s.song.id)).size).toBe(a.songs.length);
  });
});

describe('arcErrorOf', () => {
  it('scores a given order against the arc: a climbing order fits build better than a falling one', () => {
    const lo = song('lo', 'a', 'A', { energy: 0.2 });
    const mid = song('mid', 'b', 'B', { energy: 0.5 });
    const hi = song('hi', 'c', 'C', { energy: 0.9 });
    const seed = song('s', 'seed', 'S', { energy: 0.2 });
    expect(arcErrorOf([lo, mid, hi], seed, 'build')).toBeLessThan(arcErrorOf([hi, mid, lo], seed, 'build'));
    expect(arcErrorOf([], seed, 'build')).toBe(0);
  });
});
