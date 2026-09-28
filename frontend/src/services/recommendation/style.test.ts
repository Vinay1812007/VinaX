import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { makeSong } from '@/__fixtures__/songs';
import { matchesStyle, remixWorkKey, sessionStyle, songStyle, songStyles, styleEvidence, styleFromText, styleQueries, styleWhy, tuneStyle } from './style';
import { songKey } from './songIdentity';

/**
 * 8.3.0 — style detection on real catalogue shapes (titles, albums and
 * subtitles as the live search returned them on 2026-09-28).
 */
const song = (id: string, title: string, album: string | null, artist = 'Artist', over: Partial<Song> = {}): Song =>
  makeSong(id, { title, artist, album: album ? { id: `al-${id}`, name: album } : null, subtitle: album ? `${artist} - ${album}` : artist, ...over });

describe('songStyle', () => {
  it('reads DJ remixes from their titles', () => {
    for (const title of ['Nadakallo Nadaka (DJ Remix Song Version 5)', 'Gunna Gunna Mamidi (Dj Remix Version 4)', 'Silaka 2 (DJ Remix)', 'Tillu Anna Dj Pedithe (Official Remix)', 'Sajan Sajan Teri Dulhan - Dj Remix', 'Laila Main Laila Remix By Dj Notorious', 'Vaa Vaa Pakkam Vaa (Remix)']) {
      expect(songStyle(song(title, title, title)), title).toBe('dj');
    }
  });

  it('reads folk songs from their ALBUM, whose titles say nothing', () => {
    const cases: Array<[string, string]> = [
      ['Varsaina Dana O Attakutura', 'Telugu Folk Songs Telangana Janapadalu Vol - 6'],
      ['Marichepoyava Manasa', 'Telugu Folk Songs'],
      ['Maa Uri Cheruvu Venuka', 'Palle Patalu(Best Folk Songs)'],
      ['Menamama Kutura', 'Telangana Janapadalu, Vol. 2'],
      ['Oorige Male Huytu', 'Jaanapada Gonchalu (Folk Songs)'],
      ['Khel Dombari Kari', 'Lokgeete - Marathi Folk Songs'],
      ['Edhukku Pulla', 'Anthony Daasan Folk Songs : Series 1'],
    ];
    for (const [title, album] of cases) expect(songStyle(song(title, title, album)), album).toBe('folk');
    // Only the subtitle carries the album (a search row normalised without `album`).
    expect(matchesStyle(makeSong('sub', { title: 'Chelle Chandramma', subtitle: 'Jadala Ramesh - Telugu Folk Songs Telangana Janapadalu Vol - 6' }), 'folk')).toBe(true);
  });

  it('knows a folk DJ album is both, and a devotional DJ remix is both', () => {
    expect(songStyles(song('fd', 'Lachimi Na Chinni Lachimi', 'Telugu Folk Dj Songs  Vol 2')).sort()).toEqual(['dj', 'folk']);
    expect(songStyles(song('dd', 'DJ Remix Teri Bhakti Mei Mera Man Dole', 'DJ Remix Teri Bhakti Mei Mera Man Dole')).sort()).toEqual(['devotional', 'dj']);
  });

  it('reads devotional songs from devotional words, never from a deity name alone', () => {
    expect(songStyle(song('d1', 'Idhigo Bhadradri', 'Sri Bhadrachala Ramadas Keerthanams - Telugu Devotional Songs'))).toBe('devotional');
    expect(songStyle(song('d2', 'Hanuman Chalisa', 'Hanuman Chalisa – Zee Music Devotional'))).toBe('devotional');
    expect(songStyle(song('d3', 'Sankatmochan Hanuman Bhajan', 'Suresh Wadkar Devotional Songs'))).toBe('devotional');
    // A film song named after a god, from a film album, is an ordinary song.
    expect(songStyle(song('f1', 'Hanuman', 'HanuMan (Telugu)'))).toBeNull();
    expect(songStyle(song('f2', 'Krishna Nee Begane', 'Yashoda Krishna'))).toBeNull();
  });

  it('does not make a film soundtrack a DJ set because the film is called DJ', () => {
    expect(songStyle(song('dj-film', 'Pataas Pilla', 'DJ Tillu'))).toBeNull();
    expect(songStyle(song('dj-film2', 'Seeti Maar', 'DJ Duvvada Jagannadham'))).toBeNull();
    // …but a credited DJ is DJ-ish, whatever the song is called.
    expect(songStyle(makeSong('snake', { title: 'Taki Taki', artist: 'DJ Snake' }))).toBe('dj');
  });

  it('keeps ordinary film songs ordinary, and word boundaries hold', () => {
    expect(songStyle(song('o1', 'Samajavaragamana', 'Ala Vaikunthapurramuloo'))).toBeNull();
    expect(songStyle(song('o2', 'Folkshake 02', 'Folkshake 02'))).toBeNull();
    expect(songStyle(song('o3', 'Hymn for the Weekend', 'A Head Full of Dreams'))).toBeNull();
    expect(songStyle(null)).toBeNull();
  });

  it('counts genre and mood metadata as the weaker kind of evidence', () => {
    expect(styleEvidence(makeSong('g1', { genre: 'folk' }))).toEqual({ folk: 'meta' });
    expect(styleEvidence(makeSong('g2', { mood: 'devotional' }))).toEqual({ devotional: 'meta' });
    expect(styleEvidence(makeSong('g3', { genres: ['Electronic', 'EDM'] }))).toEqual({ dj: 'meta' });
    expect(styleEvidence(song('g4', 'Gana Gana Gantala', 'Lord Ganesh Devotional Songs', 'A', { genre: 'folk' }))).toEqual({ devotional: 'text', folk: 'meta' });
    expect(songStyles(song('g4', 'Gana Gana Gantala', 'Lord Ganesh Devotional Songs', 'A', { genre: 'folk' }))).toEqual(['devotional', 'folk']);
  });
});

describe('styleFromText', () => {
  it('reads a style from what the listener typed', () => {
    expect(styleFromText('telugu dj songs')).toBe('dj');
    expect(styleFromText('DJ remix')).toBe('dj');
    expect(styleFromText('folk songs')).toBe('folk');
    expect(styleFromText('janapadalu')).toBe('folk');
    expect(styleFromText('palle patalu')).toBe('folk');
    expect(styleFromText('bhojpuri lok geet')).toBe('folk');
    expect(styleFromText('telugu folk dj songs')).toBe('dj');
    expect(styleFromText('hindi bhajans')).toBe('devotional');
    expect(styleFromText('telugu 90s melodies')).toBeNull();
    expect(styleFromText('')).toBeNull();
  });
});

describe('sessionStyle', () => {
  const dj = (id: string) => song(id, `Song ${id} (DJ Remix Song)`, `Song ${id} (DJ Remix Song)`);
  const film = (id: string) => song(id, `Film ${id}`, 'Some Film');
  const folkMeta = (id: string) => makeSong(id, { genre: 'folk' });

  it('takes the style from a seed that says it', () => {
    expect(sessionStyle({ seed: dj('s') })).toEqual({ style: 'dj', from: 'seed', reinforced: false });
    expect(sessionStyle({ seed: dj('s'), recent: [dj('a'), film('b'), dj('c')] })).toEqual({ style: 'dj', from: 'seed', reinforced: true });
  });

  it('picks the style the last plays share when the seed shows two', () => {
    const both = song('fd', 'Lachimi Na Chinni Lachimi', 'Telugu Folk Dj Songs  Vol 2');
    const folk = (id: string) => song(id, `Folk ${id}`, 'Telugu Folk Songs');
    expect(sessionStyle({ seed: both, recent: [folk('a'), folk('b')] })?.style).toBe('folk');
    expect(sessionStyle({ seed: both, recent: [] })?.style).toBe('dj');
  });

  it('needs two of the last three plays to say the style when the seed only has metadata', () => {
    const folk = (id: string) => song(id, `Folk ${id}`, 'Telugu Folk Songs');
    expect(sessionStyle({ seed: folkMeta('s'), recent: [film('a'), folk('b'), film('c')] })).toBeNull();
    expect(sessionStyle({ seed: folkMeta('s'), recent: [folk('a'), film('b'), folk('c')] })).toEqual({ style: 'folk', from: 'session', reinforced: true });
    // Metadata guesses alone never start a style (a classifier can call a film song "folk").
    expect(sessionStyle({ seed: folkMeta('s'), recent: [folkMeta('a'), folkMeta('b'), folkMeta('c')] })).toBeNull();
    // Only the LAST three count.
    expect(sessionStyle({ seed: folkMeta('s'), recent: [film('a'), film('b'), film('c'), folk('d'), folk('e')] })).toBeNull();
  });

  it('carries the style past an automatic pick that strayed, and clears it on a song played by hand', () => {
    const recent = [dj('a'), dj('b'), film('c')];
    // The queue goes on after the ordinary song with another remix: still a DJ session.
    expect(sessionStyle({ seed: film('s'), recent, previous: dj('next') })).toEqual({ style: 'dj', from: 'session', reinforced: true });
    // The listener started an ordinary song themselves: a fresh queue, nothing (or itself) after it.
    expect(sessionStyle({ seed: film('s'), recent, previous: null })).toBeNull();
    expect(sessionStyle({ seed: film('s'), recent, previous: film('s') })).toBeNull();
    // …or its own album after it.
    expect(sessionStyle({ seed: film('s'), recent, previous: film('t') })).toBeNull();
  });

  it('lets a tune set, clear or leave the style', () => {
    expect(sessionStyle({ seed: film('s'), tune: 'folk' })).toEqual({ style: 'folk', from: 'tune', reinforced: true });
    expect(sessionStyle({ seed: dj('s'), tune: 'romantic' })).toBeNull();
    // "More energetic" (or "More like this" on a remix, which tunes to its mood) keeps a DJ session DJ.
    expect(sessionStyle({ seed: dj('s'), tune: 'energetic' })?.style).toBe('dj');
    expect(sessionStyle({ seed: film('s'), tune: 'energetic' })).toBeNull();
    expect(sessionStyle({ seed: dj('s'), tune: 'same-language' })?.style).toBe('dj');
    expect(sessionStyle({ seed: film('s'), moodPin: 'devotional' })?.style).toBe('devotional');
    expect(tuneStyle('dj')).toBe('dj');
    expect(tuneStyle('chill')).toBeNull();
    expect(tuneStyle(null)).toBeUndefined();
  });
});

describe('styleQueries', () => {
  it('uses the phrases the catalogue answers, in the queue language, rotating with the salt', () => {
    expect(styleQueries('dj', 'telugu', 0)).toEqual([{ query: 'telugu dj remix', page: 1 }, { query: 'telugu remix songs', page: 1 }]);
    expect(styleQueries('dj', 'telugu', 1)[0].query).toBe('telugu remix songs');
    expect(styleQueries('folk', 'tamil', 4)).toEqual([{ query: 'tamil folk songs', page: 2 }, { query: 'tamil folk songs', page: 3 }]);
    expect(styleQueries('devotional', 'unknown', 0)[0].query).toBe('devotional songs');
    const salts = new Set([0, 1, 2, 3, 4, 5].map((s) => JSON.stringify(styleQueries('folk', 'telugu', s))));
    expect(salts.size).toBeGreaterThan(1);
  });

  it('has a plain-words "why" line for each style', () => {
    expect(styleWhy('dj')).toBe('Keeps the DJ remix going');
    expect(styleWhy('folk')).toBe('More folk songs, like the one playing');
  });
});

describe('remix identity', () => {
  it('the identity contract already folds the "Version N" cuts of one remixer into one song', () => {
    const v1 = song('v1', 'Nadakallo Nadaka (DJ Remix Song)', null, 'P.N. Lingaraju');
    const v5 = song('v5', 'Nadakallo Nadaka (DJ Remix Song Version 5)', null, 'P.N. Lingaraju');
    expect(songKey(v1)).toBe(songKey(v5));
  });

  it('remixWorkKey folds remixes of one song by different remixers', () => {
    const keys = [
      song('a', 'Nadakallo Nadaka (DJ Remix Song Version 5)', null, 'P.N. Lingaraju'),
      song('b', 'Nadakallo Nadaka - Dj Remix', null, 'Dj Ganesh'),
      song('c', 'Nadakallo Nadaka Remix By Dj Nitish', null, 'Dj Nitish'),
      song('d', 'Nadakallo Nadaka', null, 'Someone'),
    ].map(remixWorkKey);
    expect(new Set(keys).size).toBe(1);
    expect(remixWorkKey(song('e', 'Silaka 2 (DJ Remix)', null))).not.toBe(remixWorkKey(song('f', 'Silaka (DJ Remix)', null)));
    expect(remixWorkKey(song('g', 'Remix', null))).toBeTruthy();
  });
});
