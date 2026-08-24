// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { recordSessionPlay, getSessionVector, clearSessionVector, energyOfSong } from './session';
import type { Song } from '@/types';

const song = (over: Partial<Song> = {}): Song => ({
  kind: 'song',
  id: Math.random().toString(36).slice(2),
  title: 'x',
  subtitle: '',
  artists: [],
  album: null,
  images: [],
  audio: [],
  duration: 0,
  language: null,
  year: null,
  explicit: false,
  hasLyrics: false,
  playCount: null,
  ...over,
});

beforeEach(() => {
  clearSessionVector();
});

describe('energyOfSong', () => {
  it('maps energetic keywords high and melancholy low', () => {
    expect(energyOfSong(song({ title: 'Party Dance Blast' }))).toBeGreaterThan(0.7);
    expect(energyOfSong(song({ title: 'Sad lonely tears' }))).toBeLessThan(0.3);
  });
  it('neutral title lands mid', () => {
    expect(energyOfSong(song({ title: 'Some Title' }))).toBeCloseTo(0.5, 1);
  });
});

describe('session vector', () => {
  it('is cold before anything plays', () => {
    const v = getSessionVector();
    expect(v.size).toBe(0);
    expect(v.mood).toBeNull();
    expect(v.energy).toBeNull();
  });

  it('tracks a melancholy run: energy trends low, mood is melancholy', () => {
    recordSessionPlay(song({ title: 'sad breakup tears', language: 'hindi' }));
    recordSessionPlay(song({ title: 'lonely heartbreak', language: 'hindi' }));
    recordSessionPlay(song({ title: 'miss you dard', language: 'hindi' }));
    const v = getSessionVector();
    expect(v.size).toBe(3);
    expect(v.mood).toBe('melancholy');
    expect(v.energy).toBeLessThan(0.35);
    expect(v.language).toBe('hindi');
  });

  it('dominant language wins the window', () => {
    recordSessionPlay(song({ title: 'a', language: 'telugu' }));
    recordSessionPlay(song({ title: 'b', language: 'telugu' }));
    recordSessionPlay(song({ title: 'c', language: 'hindi' }));
    expect(getSessionVector().language).toBe('telugu');
  });

  it('caps the rolling window at 10 songs', () => {
    for (let i = 0; i < 15; i++) recordSessionPlay(song({ title: `party ${i}`, language: 'tamil' }));
    expect(getSessionVector().size).toBe(10);
  });

  it('clears on reset', () => {
    recordSessionPlay(song({ title: 'party', language: 'tamil' }));
    expect(getSessionVector().size).toBe(1);
    clearSessionVector();
    expect(getSessionVector().size).toBe(0);
  });
});
