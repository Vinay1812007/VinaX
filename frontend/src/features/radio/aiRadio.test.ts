import { describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import { byArtist, parseRadioPrompt, pickRadioSeeds, promptQueries, RADIO_MOODS, seedsForPrompt } from './aiRadio';

describe('parseRadioPrompt', () => {
  it('reads language, decade and mood from a short request', () => {
    expect(parseRadioPrompt('  Telugu 90s   melodies ')).toEqual({ text: 'Telugu 90s melodies', language: 'telugu', decade: 1990, intent: 'melody' });
    expect(parseRadioPrompt('bollywood party')).toMatchObject({ language: 'hindi', intent: 'energetic', decade: null });
    expect(parseRadioPrompt('2000s tamil love songs')).toMatchObject({ language: 'tamil', decade: 2000, intent: 'romantic' });
  });

  it('an old decade with no mood asks for classics; a recent one asks for nothing', () => {
    expect(parseRadioPrompt('80s hindi').intent).toBe('classics');
    expect(parseRadioPrompt('2010s hindi').intent).toBeNull();
  });

  it('an artist name is just words: no language, decade or mood', () => {
    expect(parseRadioPrompt('Sid Sriram')).toEqual({ text: 'Sid Sriram', language: null, decade: null, intent: null });
  });

  it('clips very long input', () => {
    expect(parseRadioPrompt('a'.repeat(200)).text).toHaveLength(80);
  });
});

describe('promptQueries', () => {
  it('uses short catalogue shapes plus the listener words, never repeated', () => {
    expect(promptQueries(parseRadioPrompt('Telugu 90s melodies'), 'hindi')).toEqual(['telugu melody songs', '90s telugu songs', 'telugu 90s melodies']);
    // No language named: the listener's own language fills in for the mood query.
    expect(promptQueries(parseRadioPrompt('sad'), 'hindi')).toEqual(['hindi sad songs', 'sad']);
    expect(promptQueries(parseRadioPrompt('Sid Sriram'), 'telugu')).toEqual(['sid sriram']);
  });
});

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
});

describe('byArtist', () => {
  it('keeps songs credited to the artist', () => {
    const songs = [makeSong('x', { artist: 'Sid Sriram' }), makeSong('y', { artist: 'Someone Else' })];
    expect(byArtist(songs, 'sid sriram').map((s) => s.id)).toEqual(['x']);
    expect(byArtist(songs, ' ')).toEqual([]);
  });
});

describe('seedsForPrompt', () => {
  it('finds seeds in the catalogue without asking the AI', async () => {
    const search = vi.fn(async (q: string) => (q.includes('melody') ? [makeSong('m1', { year: '1996' }), makeSong('m2')] : [makeSong('t1')]));
    const ai = vi.fn(async () => [makeSong('ai')]);
    const r = await seedsForPrompt('Telugu 90s melodies', 'hindi', { search, ai });
    expect(r.via).toBe('catalogue');
    expect(r.seeds[0].id).toBe('m1');
    expect(ai).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('falls back to the AI playlist service when the catalogue finds too little, and survives failures', async () => {
    const search = vi.fn(async () => {
      throw new Error('offline');
    });
    const ai = vi.fn(async () => [makeSong('ai1'), makeSong('ai2')]);
    const r = await seedsForPrompt('songs for a long drive at night', 'telugu', { search, ai });
    expect(r.via).toBe('ai');
    expect(r.seeds.map((s) => s.id)).toEqual(['ai1', 'ai2']);
    const none = await seedsForPrompt('zzz', null, { search, ai: async () => { throw new Error('x'); } });
    expect(none).toMatchObject({ seeds: [], via: 'none' });
    expect((await seedsForPrompt('   ', null, { search })).via).toBe('none');
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

  it('reads a style from the words and asks the catalogue for it', () => {
    expect(parseRadioPrompt('telugu dj songs')).toMatchObject({ language: 'telugu', intent: 'dj' });
    expect(parseRadioPrompt('folk songs').intent).toBe('folk');
    expect(parseRadioPrompt('janapadalu').intent).toBe('folk');
    expect(promptQueries(parseRadioPrompt('telugu dj songs'), 'hindi')).toEqual(['telugu dj remix', 'telugu remix songs', 'telugu dj songs']);
    expect(promptQueries(parseRadioPrompt('folk songs'), 'kannada')).toEqual(['kannada folk songs', 'folk songs']);
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

  it('8.3.1 — "dj" in a film name, or a remix turned down, is no DJ radio', () => {
    expect(parseRadioPrompt('DJ Tillu').intent).toBeNull();
    expect(promptQueries(parseRadioPrompt('dj tillu songs'), 'telugu')).toEqual(['dj tillu songs']);
    expect(parseRadioPrompt('arijit singh songs without remix').intent).toBeNull();
    expect(promptQueries(parseRadioPrompt('arijit singh songs without remix'), 'hindi')).toEqual(['arijit singh songs without remix']);
    // Native-script words name a style too.
    expect(parseRadioPrompt('भजन').intent).toBe('devotional');
    expect(parseRadioPrompt('జానపద పాటలు').intent).toBe('folk');
  });

  it('a style request seeds from the style', async () => {
    const search = vi.fn(async (q: string) => (q === 'telugu dj remix' ? [makeSong('film', { title: 'Film Hit', artist: 'X' }), dj('d1', 'Silaka 2 (DJ Remix)', 'Laxmi Dasa'), dj('d2', 'Mama Nagulo (DJ Remix Song)', 'Peddapuli Eeswar')] : []));
    const r = await seedsForPrompt('telugu dj songs', null, { search });
    expect(r.parsed.intent).toBe('dj');
    expect(r.seeds.slice(0, 2).map((s) => s.id).sort()).toEqual(['d1', 'd2']);
  });
});
