import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { createEmptyProfile } from '@/services/personalization/profile';
import { buildSongProfile, buildUserRecommendationProfile, buildSessionRecommendationProfile } from './profiles';

const song = (over: Partial<Song> = {}): Song => ({
  kind: 'song', id: 's1', title: 'Romantic Night', subtitle: 'Artist',
  artists: [{ id: 'a1', name: 'Artist' }], album: null, images: [], audio: [],
  duration: 180, language: 'telugu', year: '2025', explicit: false,
  hasLyrics: true, playCount: 10, ...over,
});

describe('recommendation profiles', () => {
  it('normalizes content metadata and infers missing genre/vibe', () => {
    const profile = buildSongProfile(song({ dialect: 'Coastal', genre: 'Film', vibe: 'Warm', energy: 0.8, tempo: 128 }));
    expect(profile.dialect).toBe('coastal');
    expect(profile.genres).toContain('film');
    expect(profile.vibes).toContain('warm');
    expect(profile.energy).toBe(0.8);
    expect(profile.tempo).toBe(128);
  });

  it('builds user and session aggregates from favorites/history', () => {
    const a = song();
    const b = song({ id: 's2', title: 'Party Dance', language: 'hindi' });
    const user = buildUserRecommendationProfile(createEmptyProfile(), [a], [{ song: b, ts: Date.now(), completed: true }]);
    const session = buildSessionRecommendationProfile([a, b]);
    expect(user.likedSongIds.has('s1')).toBe(true);
    expect(user.languages.telugu).toBeGreaterThan(0);
    expect(session.recentSongIds.size).toBe(2);
    expect(session.avgEnergy).not.toBeNull();
  });
});

describe('v7.0.0 — untrusted persisted songs', () => {
  it('builds a profile from a song whose artists field is malformed instead of throwing', async () => {
    const { buildSongProfile, buildUserRecommendationProfile } = await import('./profiles');
    const { createEmptyProfile } = await import('../personalization/profile');
    const broken = { kind: 'song', id: 'x', title: 'Broken', subtitle: 'Someone', artists: { primary: [{ id: 'a', name: 'Someone' }] }, album: null, images: [], audio: [], duration: 200, language: 'telugu', year: null, explicit: false, hasLyrics: false, playCount: null } as unknown as import('../../types').Song;
    expect(buildSongProfile(broken).artistNames).toEqual([]);
    expect(() => buildUserRecommendationProfile(createEmptyProfile(0), [broken], [{ song: broken, ts: 1, completed: true }])).not.toThrow();
  });
});
