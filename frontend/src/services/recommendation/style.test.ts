import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { makeSong } from '@/__fixtures__/songs';
import { matchesStyle, remixWorkKey, sessionStyle, songStyle, songStyles, songTextStyle, styleEvidence, styleFromText, styleQueries, styleWhy, tuneStyle, turnedAway } from './style';
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

/**
 * 8.3.1 — review findings, each on rows the live catalogue returned on
 * 2026-09-29 (title, album, credited artists, and the "Artists - Album"
 * subtitle search rows carry).
 */
const row = (title: string, album: string | null, artists: string[]): Song =>
  makeSong(`row-${title}-${album}-${artists[0]}`, {
    title,
    artist: artists[0],
    artists: artists.map((name, i) => ({ id: `a${i}-${name}`, name })),
    album: album ? { id: `al-${album}`, name: album } : null,
    subtitle: album ? `${artists.join(', ')} - ${album}` : artists.join(', '),
  });

describe('8.3.1 — a singer or a character is not a devotional word', () => {
  it('reads no style from an artist credit (Aarti Mukherji sings film songs)', () => {
    expect(songStyle(row('Husn Hai Ya Koi Qayamat Hai', 'Saudagar', ['Mohammed Rafi', 'Aarti Mukherji']))).toBeNull();
    expect(songStyle(row('Do Naina Aur Ek Kahani', 'Masoom', ['Aarti Mukherji']))).toBeNull();
    expect(songStyle(row('Kabhi Kuchh Pal Jeevan Ke', 'Rang Birangi', ['Aarti Mukherji', 'Anuradha Paudwal', 'R.D. Burman']))).toBeNull();
    // A row normalised without `album`: only the subtitle carries it.
    const bare = makeSong('husn-sub', { title: 'Husn Hai Ya Koi Qayamat Hai', artist: 'Mohammed Rafi', subtitle: 'Mohammed Rafi, Aarti Mukherji - Saudagar' });
    expect(songStyle(bare)).toBeNull();
    // Credits only, no album anywhere.
    expect(songStyle(makeSong('husn-credits', { title: 'Husn Hai Ya Koi Qayamat Hai', artist: 'Aarti Mukherji', subtitle: 'Mohammed Rafi, Aarti Mukherji' }))).toBeNull();
  });

  it('reads no style from a name in a film title ("Keerthana" is a love song, a character)', () => {
    expect(songStyle(row('Keerthana', 'En Paadal Unakaga', ['Ilaiyaraaja', 'Mano']))).toBeNull();
    expect(songStyle(row('Keerthana', 'Kadaisi Ulaga Por (Original Motion Picture Soundtrack)', ['Vignesh Srikanth', 'Hiphop Tamizha', 'Rakhooo']))).toBeNull();
    expect(songStyle(row("Keerthana's Masterplan", 'Mr. Local (Original Background Score)', ['Hiphop Tamizha']))).toBeNull();
  });

  it('still reads those words in an album, or in a title with a deity', () => {
    for (const [title, album] of [
      ['Aarti Kunj Bihari Ki', 'Aarti Vol-5'],
      ['Jai Ganesh Deva', 'Aarti Vol-3'],
      ['Om Jai Jagdish Hare', 'Sampurna Aarti Sangrah'],
      ['Ganesh Aarti', 'Lakshmi Poojan'],
      ['Aarti Keeje Hanuman Lala Ki', 'Shree Hanuman Chalisa (Hanuman Ashtak)'],
      ['Alarachanchalanai', 'Annamayya Keerthana, Vol. 1'],
      ['Keerthana Vichakshana', 'Ayyappa Swamy (Harikathe)'],
      ['Chandra Chooda (Keerthanam)', 'Karmayogi'],
      ['Hanuman Chalisa (From "Hanuman Chalisa - Zee Music Devotional")', 'Morning Bhakti'],
    ]) {
      expect(songStyle(row(title, album, ['Singer'])), `${title} | ${album}`).toBe('devotional');
    }
  });
});

describe('8.3.1 — a film called DJ is not a DJ remix', () => {
  it('ignores a (From "…") film credit in the title', () => {
    expect(songStyle(row('Seeti Maar (From "DJ")', 'Musical Smash Busters of 2017', ['Jaspreet Jasz', 'Rita Thyagarajan']))).toBeNull();
    expect(songStyle(row('Seeti Maar (From"DJ")', 'Gorgeous Pooja Hegde', ['Jaspreet Jasz', 'Rita Thyagarajan']))).toBeNull();
    expect(songStyle(row('Pataas Pilla (From "DJ Tillu")', "Valentine's Day Special Songs", ['Anirudh Ravichander']))).toBeNull();
    expect(songStyle(row('Pataas Pilla ( From "DJ Tillu")', 'Fresh Face To Tollywood', ['Anirudh Ravichander']))).toBeNull();
    expect(songStyle(row('Tillu Anna DJ Pedithe (From "DJ Tillu")', 'DJ Tonight', ['Ram Miriyala']))).toBeNull();
  });

  it('ignores a bare "DJ" in a title from a film called DJ…', () => {
    expect(songStyle(row('DJ Tillu Title Song (Hindi)', 'DJ Tillu', ['Mika Singh']))).toBeNull();
    expect(songStyle(row('DJ Duvvada Jagannadham (Intro)', 'DJ', ['Devi Sri Prasad']))).toBeNull();
    expect(songStyle(row('Tillu Anna DJ Pedithe', 'DJ Tillu', ['Ram Miriyala']))).toBeNull();
    // Probed: a 2017 film song from "DJ" (Duvvada Jagannadham), sung by Vijay Prakash — not a remix.
    expect(songStyle(row('DJ Saranam Bhaje Bhaje', 'DJ', ['Vijay Prakash']))).toBeNull();
    expect(songStyle(row('DJ Saranam Bhaje Bhaje (From "DJ")', 'The Rising Queen Pooja Hegde', ['Vijay Prakash']))).toBeNull();
  });

  it('needs a DJ cue for a bare "DJ": a song about a DJ, or called "DJ", is an ordinary song', () => {
    expect(songStyle(row('Dj Waley Babu', 'Dj Waley Babu', ['Badshah']))).toBeNull();
    expect(songStyle(row('DJ Pe Matkungi', 'DJ Pe Matkungi', ['Renuka Panwar', 'Pranjal Dahiya']))).toBeNull();
    expect(songStyle(row('DJ', 'DJ', ['Happy Singh', 'Bablu Ankiya']))).toBeNull();
  });

  it('still reads remixes, DJ versions and credited DJs', () => {
    for (const [title, album, artist] of [
      ['Tillu Anna Dj Pedithe (Official Remix)', 'Tillu Anna Dj Pedithe (Official Remix)', 'Ram Miriyala'],
      ['Radhika - Official Remix', 'Radhika - Official Remix (From "Tillu Square")', 'Ram Miriyala'],
      ['Addagutta Kiran Bhai Dj Song', 'Telangana Folk Songs', 'Peddapuli Eshwar'],
      ['Bonalu Song DJ Version 2024', 'Bonalu Song DJ Version 2024', 'Mangli'],
      ['Ededu Dappulla Bonalu DJ', 'Ededu Dappulla Bonalu DJ', 'Ellamma Ashok'],
      ['Dj Rona Rangila Mafiya (Dj Kamlesh)', 'Dj Rona Rangila Mafiya (Dj Kamlesh)', 'Gaman Santhal'],
      ['DJ Wale Babu (Hip Hop Mix)', 'The Dance Project (Season 1: Episode 12)', 'Badshah'],
      ['Dj Jordar Garba Nonstop', 'Dj Jordar Garba Nonstop', 'Gaman Santhal'],
      ['DJ Hanuman Chalisa', 'DJ Hanuman Chalisa', 'Raj Sachdev'],
      ['Bava Ninu Chudapothe DJ', 'Banjara Folk DJ Songs 2019', 'Kandakatla Ramakrishna'],
      ['Mittai - Dj Remix - Dj John', null, 'Dj John'],
    ] as Array<[string, string | null, string]>) {
      expect(styleEvidence(row(title, album, [artist])).dj, title).toBe('text');
    }
    // A credited DJ, from the subtitle when `artists` is short.
    expect(styleEvidence(makeSong('bb', { title: 'Birthday Band', artists: [], album: { id: 'al', name: 'Birthday Band' }, subtitle: 'DJ Saikiran Tillu ft. SBS Musicals - Birthday Band' })).dj).toBe('text');
  });

  it('keeps the "text" evidence for styles, and reads each song once', () => {
    const s = row('Nadakallo Nadaka (DJ Remix Song)', 'Nadakallo Nadaka (DJ Remix Song)', ['P.N. Lingaraju']);
    expect(styleEvidence(s)).toBe(styleEvidence(s));
    expect(songTextStyle(s)).toBe('dj');
    expect(songTextStyle(makeSong('g', { genre: 'folk' }))).toBeNull();
  });
});

describe('8.3.1 — styleFromText reads what the listener meant', () => {
  it('does not take a film called "DJ Tillu" for DJ remixes', () => {
    expect(styleFromText('DJ Tillu')).toBeNull();
    expect(styleFromText('dj tillu songs')).toBeNull();
    expect(styleFromText('telugu dj tillu movie songs')).toBeNull();
    expect(styleFromText('dj')).toBe('dj');
    expect(styleFromText('telugu dj')).toBe('dj');
    expect(styleFromText('dj mix')).toBe('dj');
    expect(styleFromText('tillu remix')).toBe('dj');
  });

  it('hears a cue turned down', () => {
    expect(styleFromText('arijit singh songs without remix')).toBeNull();
    expect(styleFromText('no dj songs please')).toBeNull();
    expect(styleFromText('romantic songs, not folk')).toBeNull();
    expect(styleFromText('avoid bhajans')).toBeNull();
    // A negation in another clause does not reach it.
    expect(styleFromText('no film songs, only dj remix')).toBe('dj');
  });

  it('reads name-like devotional words only as a request for them', () => {
    expect(styleFromText('aarti mukherjee songs')).toBeNull();
    expect(styleFromText('keerthana')).toBeNull();
    expect(styleFromText('ganesh aarti')).toBe('devotional');
    expect(styleFromText('bhakti songs')).toBe('devotional');
    expect(styleFromText('annamayya keerthanalu')).toBe('devotional');
  });

  it('reads a few native-script words', () => {
    expect(styleFromText('भजन')).toBe('devotional');
    expect(styleFromText('హిందీ భక్తి పాటలు')).toBe('devotional');
    expect(styleFromText('பக்தி பாடல்கள்')).toBe('devotional');
    expect(styleFromText('జానపద పాటలు')).toBe('folk');
    expect(styleFromText('நாட்டுப்புற பாடல்கள்')).toBe('folk');
    expect(styleFromText('भोजपुरी लोकगीत')).toBe('folk');
    expect(styleFromText('तेलुगु रीमिक्स')).toBe('dj');
  });
});

describe('8.3.1 — skipped plays do not keep a style going', () => {
  const remix = (id: string) => row(`Song ${id} (DJ Remix Song)`, `Song ${id} (DJ Remix Song)`, [`Dj ${id}`]);
  const film = (id: string) => row(`Film ${id}`, 'Some Film', ['Singer']);

  it('ends a style the songs set after two skipped songs of it, until one is played through', () => {
    expect(turnedAway([{ song: remix('a'), skipped: true }, { song: remix('b'), skipped: true }], 'dj')).toBe(true);
    expect(turnedAway([{ song: remix('a'), skipped: true }, { song: film('x'), skipped: false }, { song: remix('b'), skipped: true }], 'dj')).toBe(true);
    expect(turnedAway([{ song: remix('a'), skipped: true }, { song: remix('b'), skipped: false }, { song: remix('c'), skipped: true }], 'dj')).toBe(false);
    expect(turnedAway([{ song: remix('a'), skipped: true }], 'dj')).toBe(false);
  });

  it('three skipped remixes, then a favourite film song: the next stretch is not forced to DJ', () => {
    const skipped = [remix('r3'), remix('r2'), remix('r1')];
    const sitting = [...skipped.map((song) => ({ song, skipped: true })), { song: remix('r0'), skipped: false }, { song: remix('r00'), skipped: false }];
    const heard = [remix('r0'), remix('r00')];
    // The queue goes on with another (automatic) remix after the film song.
    expect(sessionStyle({ seed: film('fav'), recent: heard, sitting, previous: remix('next') })).toBeNull();
    // Even a remix seed (the next automatic pick) no longer holds the sitting to DJ…
    expect(sessionStyle({ seed: remix('auto'), recent: heard, sitting })).toBeNull();
    // …but asking for it does.
    expect(sessionStyle({ seed: film('fav'), recent: heard, sitting, tune: 'dj' })?.style).toBe('dj');
  });
});

describe('8.3.1 — remix identity', () => {
  it('folds two remixers credited after a second dash into one work', () => {
    const john = row('Mittai - Dj Remix - Dj John', null, ['Dj John']);
    const guna = row('Mittai - Dj Remix - Dj Guna', null, ['Dj Guna']);
    expect(remixWorkKey(john)).toBe(remixWorkKey(guna));
    expect(remixWorkKey(john)).toBe(remixWorkKey(row('Mittai (Dj Remix)', null, ['Dj Other'])));
    expect(remixWorkKey(row('Na Sanam Pucha Kathi - Dj Remix - Dj Aslae', null, ['Dj Aslae']))).toBe(remixWorkKey(row('Na Sanam Pucha Kathi - Dj Remix - Dj Other', null, ['Dj Other'])));
  });

  it('keeps different songs that are all called "DJ" apart', () => {
    expect(remixWorkKey(row('DJ', 'DJ', ['Happy Singh']))).not.toBe(remixWorkKey(row('DJ', 'DJ', ['Humane Sagar'])));
    expect(remixWorkKey(row('Dj', 'Hey Bro', ['Sunidhi Chauhan']))).not.toBe(remixWorkKey(row('DJ', 'DJ', ['Humane Sagar'])));
  });
});
