// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { createEmptyProfile } from '@/services/personalization/profile';
import { personalOrder, seededRandom, tasteLens } from './personalize';

const song = (id: string, artistId: string, artistName = artistId): Song =>
  ({ id, title: `Song ${id}`, subtitle: artistName, artists: [{ id: artistId, name: artistName }] }) as unknown as Song;

const scored = (n: number, top = 1, step = 0.01, artist = (i: number) => `a${i}`) =>
  Array.from({ length: n }, (_, i) => ({ song: song(`s${i}`, artist(i)), score: top - i * step }));

describe('11.7 personalOrder', () => {
  it('never drops or duplicates an item', () => {
    const list = scored(40);
    const out = personalOrder(list, { take: 10, random: seededRandom(7) });
    expect(out).toHaveLength(40);
    expect(new Set(out.map((x) => x.song.id)).size).toBe(40);
  });

  it('varies which close contenders win from one draw to the next', () => {
    const list = scored(60, 1, 0.002);
    const tops = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      tops.add(personalOrder(list, { take: 20, random: seededRandom(seed) }).slice(0, 20).map((x) => x.song.id).join(','));
    }
    expect(tops.size).toBeGreaterThan(15);
  });

  it('never lets a weak match jump strong ones', () => {
    const strong = scored(30, 1, 0.005);
    const weak = Array.from({ length: 10 }, (_, i) => ({ song: song(`w${i}`, `w${i}`), score: 0.2 }));
    for (let seed = 1; seed <= 200; seed += 1) {
      const top = personalOrder([...strong, ...weak], { take: 10, random: seededRandom(seed) }).slice(0, 10);
      expect(top.every((x) => !x.song.id.startsWith('w'))).toBe(true);
    }
  });

  it('keeps tiers apart (model-space before on-device)', () => {
    const list = [
      ...scored(5, 0.4).map((x) => ({ ...x, space: 'model' })),
      ...scored(5, 0.99).map((x) => ({ ...x, song: { ...x.song, id: `l${x.song.id}` }, space: 'local' })),
    ];
    const out = personalOrder(list, { take: 3, random: seededRandom(3), tier: (x) => x.space });
    expect(out.slice(0, 5).every((x) => x.space === 'model')).toBe(true);
  });

  it('lifts a loved artist and sinks one the listener keeps skipping', () => {
    const profile = createEmptyProfile(0);
    profile.artists.loved = { name: 'Loved', score: 30, plays: 20, completes: 18, skips: 0, lastTs: 0 };
    profile.artists.skipped = { name: 'Skipped', score: 0, plays: 8, completes: 1, skips: 7, lastTs: 0 };
    const lens = tasteLens(profile, []);
    const list = [
      { song: song('x', 'skipped', 'Skipped'), score: 0.6 },
      { song: song('y', 'stranger', 'Stranger'), score: 0.6 },
      { song: song('z', 'loved', 'Loved'), score: 0.6 },
    ];
    const out = personalOrder(list, { take: 3, lens, noiseShare: 0 });
    expect(out.map((x) => x.song.id)).toEqual(['z', 'y', 'x']);
  });

  it('counts a favourite song’s artist as taste even with no plays', () => {
    const lens = tasteLens(createEmptyProfile(0), [song('f', 'fav', 'Fav Artist')]);
    expect(lens(song('q', 'fav', 'Fav Artist'))).toBeGreaterThan(0);
    expect(lens(song('r', 'other', 'Other'))).toBe(0);
  });
});
