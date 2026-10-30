import { describe, expect, it } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import { byArtist, pickRadioSeeds, RADIO_MOODS } from './radioSeeds';

describe('pickRadioSeeds', () => {
  const a = makeSong('a', { year: '1995' });
  const b = makeSong('b', { year: '2021' });
  const c = makeSong('c', { year: '1992' });
  const hindi = makeSong('h', { language: 'hindi', year: '1994' });
  const sameTitle = makeSong('a2', { title: 'Song a' });

  it('round-robins across lists, drops repeats and other languages, and puts the decade first', () => {
    const seeds = pickRadioSeeds([[b, a], [hindi, c, sameTitle]], { language: 'telugu', decade: 1990 });
    expect(seeds.map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('skips blocked songs, caps the count and rotates the opening', () => {
    const list = ['1', '2', '3', '4', '5', '6', '7'].map((id) => makeSong(id));
    expect(pickRadioSeeds([list], { blocked: (s) => s.id === '1', max: 3 }).map((s) => s.id)).toEqual(['2', '3', '4']);
    expect(pickRadioSeeds([list], { rotate: 2, max: 3 }).map((s) => s.id)).toEqual(['3', '4', '5']);
    expect(pickRadioSeeds([], {})).toEqual([]);
  });

  it('an artist request opens on that artist and rotates within their songs', () => {
    const list = [makeSong('o1', { artist: 'Someone Else' }), makeSong('a1', { artist: 'Sid Sriram' }), makeSong('a2', { artist: 'Sid Sriram' }), makeSong('o2', { artist: 'Another' })];
    for (let rotate = 0; rotate < 3; rotate += 1) {
      const seeds = pickRadioSeeds([list], { artist: 'Sid Sriram', rotate });
      expect(['a1', 'a2']).toContain(seeds[0].id);
      expect(seeds.map((s) => s.id).slice(0, 2).sort()).toEqual(['a1', 'a2']);
    }
  });
});

describe('byArtist', () => {
  it('keeps songs credited to the artist', () => {
    const songs = [makeSong('x', { artist: 'Sid Sriram' }), makeSong('y', { artist: 'Someone Else' })];
    expect(byArtist(songs, 'sid sriram').map((s) => s.id)).toEqual(['x']);
    expect(byArtist(songs, ' ')).toEqual([]);
  });
});

describe('RADIO_MOODS', () => {
  it('every mood is a tune with a catalogue query', async () => {
    const { tuneSearchQuery } = await import('@/services/recommendation/tune');
    for (const m of RADIO_MOODS) expect(tuneSearchQuery(m.id, 'telugu')).toBeTruthy();
  });
});

describe('8.3.0 — DJ remix and folk radio', () => {
  const dj = (id: string, title: string, artist = 'P.N. Lingaraju') => makeSong(id, { title, artist, album: { id, name: title } });
  const folk = (id: string, title: string) => makeSong(id, { title, artist: 'A. Ramadevi', album: { id: 'f', name: 'Telugu Folk Songs Telangana Janapadalu Vol - 6' } });

  it('offers DJ remix and Folk tiles', () => {
    expect(RADIO_MOODS.map((m) => m.id)).toEqual(expect.arrayContaining(['dj', 'folk', 'devotional']));
    expect(RADIO_MOODS.find((m) => m.id === 'dj')?.label).toBe('DJ remix');
  });

  it('opens a style radio on songs in the style, one cut per song', () => {
    const list = [makeSong('film', { title: 'Film Hit', artist: 'X' }), dj('v1', 'Nadakallo Nadaka (DJ Remix Song)'), dj('v5', 'Nadakallo Nadaka (DJ Remix Song Version 5)'), dj('d2', 'Mama Nagulo (DJ Remix Song)', 'Peddapuli Eeswar'), folk('f1', 'Chelle Chandramma')];
    for (let rotate = 0; rotate < 4; rotate += 1) {
      const seeds = pickRadioSeeds([list], { style: 'dj', rotate });
      expect(seeds.map((s) => s.id).filter((id) => id.startsWith('v'))).toHaveLength(1);
      expect(['v1', 'd2']).toContain(seeds[0].id);
    }
    expect(pickRadioSeeds([list], { style: 'folk' })[0].id).toBe('f1');
  });
});
