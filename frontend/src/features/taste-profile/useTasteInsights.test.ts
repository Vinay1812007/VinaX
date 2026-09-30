// @vitest-environment jsdom
/** 8.5.0 — the listening-style numbers on the taste profile page. */
import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { createEmptyProfile } from '@/services/personalization/profile';
import { newToYouShare, topMoods } from './useTasteInsights';

const DAY = 86_400_000;
const NOW = 100 * DAY;

const song = (title: string): Song => ({
  kind: 'song',
  id: title,
  title,
  subtitle: 'Singer',
  artists: [{ id: 'a', name: 'Singer' }],
  album: null,
  images: [],
  audio: [],
  duration: 200,
  language: 'telugu',
  year: '2024',
  explicit: false,
  hasLyrics: false,
  playCount: null,
});

const play = (artist: string, ts = NOW - DAY) => ({ type: 'play', ts, artistNames: [artist] });

describe('newToYouShare', () => {
  const profile = createEmptyProfile(0);
  profile.artists.known = { name: 'Known Voice', score: 20, plays: 40, completes: 30, skips: 1, lastTs: 0 };
  profile.artists.fresh = { name: 'Fresh Voice', score: 2, plays: 2, completes: 1, skips: 0, lastTs: 0 };

  it('is the share of recent plays by artists with at most three plays in the profile', () => {
    const events = [...Array.from({ length: 6 }, () => play('Known Voice')), ...Array.from({ length: 2 }, () => play('Fresh Voice')), play('never seen'), play('NEVER SEEN')];
    expect(newToYouShare(profile, events, NOW)).toBeCloseTo(4 / 10);
  });

  it('ignores plays older than 30 days and non-play events', () => {
    const events = [
      ...Array.from({ length: 10 }, () => play('Known Voice')),
      ...Array.from({ length: 5 }, () => play('Fresh Voice', NOW - 31 * DAY)),
      { type: 'skip', ts: NOW - DAY, artistNames: ['Fresh Voice'] },
    ];
    expect(newToYouShare(profile, events, NOW)).toBe(0);
  });

  it('says nothing (null) below ten recent plays', () => {
    expect(newToYouShare(profile, Array.from({ length: 9 }, () => play('Fresh Voice')), NOW)).toBeNull();
    expect(newToYouShare(profile, [], NOW)).toBeNull();
  });
});

describe('topMoods', () => {
  it('ranks the moods that titles name and leaves neutral songs out of the shares', () => {
    const moods = topMoods([song('Love Story'), song('Pyaar Hua'), song('Dance Floor'), song('Untitled'), song('Plain')]);
    expect(moods[0]).toEqual({ mood: 'romantic', share: 2 / 3 });
    expect(moods[1]).toEqual({ mood: 'energetic', share: 1 / 3 });
    expect(moods.find((m) => (m.mood as string) === 'neutral')).toBeUndefined();
  });

  it('is empty when nothing names a mood', () => {
    expect(topMoods([song('Plain'), song('Other')])).toEqual([]);
  });
});
