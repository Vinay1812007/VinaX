// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { buildDigest, earnedBadgeIds } from './store';

const song = (id: string): Song => ({ id, title: id, subtitle: 'A', images: [{ quality: '500x500', url: `u/${id}` }], language: 'telugu', year: '2020', duration: 200 } as unknown as Song);

describe('15.0 — the profile digest', () => {
  it('takes top artists, language shares and up to 20 recent likes, pared down', () => {
    const profile = {
      artists: { sid: { name: 'Sid Sriram', plays: 12, score: 5 }, arm: { name: 'Armaan', plays: 3, score: 1 } },
      languages: { telugu: { score: 3 }, hindi: { score: 1 }, unknown: { score: 9 } },
    } as never;
    const d = buildDigest(Array.from({ length: 25 }, (_, i) => song(`s${i}`)), profile);
    expect(d.topArtists[0]).toEqual({ name: 'Sid Sriram', plays: 12 });
    expect(d.topLanguages).toEqual([{ id: 'telugu', pct: 75 }, { id: 'hindi', pct: 25 }]);
    expect(d.recentLikes).toHaveLength(20);
    expect(d.recentLikes[0]).toEqual({ id: 's0', title: 's0', subtitle: 'A', image: 'u/s0', language: 'telugu', year: '2020', duration: 200 });
    expect(d.badges).toEqual([]);
  });

  it('1.12 — carries the badges earned, oldest first, read from the ledger without the engine', () => {
    localStorage.setItem(KEYS.badges, JSON.stringify({ earned: { century: '2026-03-01', 'first-note': '2026-01-02', junk: 5 }, counters: {} }));
    expect(earnedBadgeIds()).toEqual(['first-note', 'century']);
    expect(buildDigest([], { artists: {}, languages: {} } as never).badges).toEqual(['first-note', 'century']);
    localStorage.setItem(KEYS.badges, '[1]');
    expect(earnedBadgeIds()).toEqual([]);
    localStorage.clear();
  });
});
