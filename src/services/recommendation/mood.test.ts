import { describe, it, expect } from 'vitest';
import { inferMood, moodMatchScore } from './mood';
import type { Song } from '../../types';

const song = (title: string, subtitle = ''): Song => ({
  kind: 'song',
  id: 'x',
  title,
  subtitle,
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
});

describe('inferMood', () => {
  it('detects each mood from keywords', () => {
    expect(inferMood(song('Tum Hi Ho', 'a love song'))).toBe('romantic');
    expect(inferMood(song('Party Dance Anthem'))).toBe('energetic');
    expect(inferMood(song('Lofi Chill Night'))).toBe('chill');
    expect(inferMood(song('Sad Alone Tears'))).toBe('melancholy');
    expect(inferMood(song('Krishna Bhajan'))).toBe('devotional');
  });

  it('falls back to neutral and tolerates null', () => {
    expect(inferMood(song('Generic Track 7'))).toBe('neutral');
    expect(inferMood(null)).toBe('neutral');
  });
});

describe('moodMatchScore', () => {
  it('rewards a match, flexes on neutral, stays low otherwise', () => {
    expect(moodMatchScore('romantic', 'romantic')).toBe(1);
    expect(moodMatchScore('romantic', 'neutral')).toBe(0.4);
    expect(moodMatchScore('romantic', 'energetic')).toBe(0.1);
  });
});
