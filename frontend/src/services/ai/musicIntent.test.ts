import { describe, expect, it } from 'vitest';
import { MAX_REQUESTED_SONGS, catalogQueries, intentTitle, looksLikeNaturalLanguage, parseMusicIntent, requestedSongCount, seedOf } from './musicIntent';

describe('parseMusicIntent', () => {
  it('reads language, activity and energy from a playlist request', () => {
    const i = parseMusicIntent('Make me a Telugu workout playlist with high-energy songs.');
    expect(i.languages).toEqual(['telugu']);
    expect(i.activity).toBe('workout');
    expect(i.energy).toBe('high');
    expect(i.moods).toContain('energetic');
  });

  it('reads moods, film-industry names and decades', () => {
    const i = parseMusicIntent('sad tollywood songs from the 90s for rain');
    expect(i.languages).toEqual(['telugu']);
    expect(i.moods).toContain('melancholy');
    expect(i.activity).toBe('rain');
    expect(i.decade).toBe(1990);
    expect(i.era).toBe('classic');
  });

  it('infers energy from an activity when none is stated', () => {
    expect(parseMusicIntent('hindi songs for the gym').energy).toBe('high');
    expect(parseMusicIntent('songs to study to').energy).toBe('low');
  });

  it('keeps content words (names) as keywords', () => {
    expect(parseMusicIntent('anirudh songs for a party').keywords).toEqual(['anirudh']);
  });
});

describe('looksLikeNaturalLanguage', () => {
  it('flags descriptions', () => {
    expect(looksLikeNaturalLanguage('sad telugu songs for rain')).toBe(true);
    expect(looksLikeNaturalLanguage('high energy workout hindi')).toBe(true);
    expect(looksLikeNaturalLanguage('chill songs for sleep')).toBe(true);
    expect(looksLikeNaturalLanguage('arijit sad songs')).toBe(true);
  });
  it('leaves titles, names and plain language searches alone', () => {
    expect(looksLikeNaturalLanguage('arijit singh')).toBe(false);
    expect(looksLikeNaturalLanguage('telugu songs')).toBe(false);
    expect(looksLikeNaturalLanguage('samajavaragamana')).toBe(false);
    expect(looksLikeNaturalLanguage('ala vaikunthapurramuloo songs')).toBe(false);
    expect(looksLikeNaturalLanguage('love me like you do')).toBe(false);
    expect(looksLikeNaturalLanguage('party all night')).toBe(false);
  });
});

describe('catalogQueries', () => {
  it('uses only the short phrasings the catalogue answers', () => {
    const q = catalogQueries(parseMusicIntent('Make me a Telugu workout playlist with high-energy songs.'), ['hindi']);
    expect(q.slice(0, 2)).toEqual(['telugu dance songs', 'telugu mass songs']);
    for (const s of q) expect(s.split(' ').length).toBeLessThanOrEqual(3);
    expect(q.join(' ')).not.toMatch(/workout|high|energy/);
  });

  it('falls back to the saved languages when the request names none', () => {
    expect(catalogQueries(parseMusicIntent('something romantic for tonight'), ['tamil'])[0]).toBe('tamil romantic songs');
  });

  it('interleaves two named languages', () => {
    expect(catalogQueries(parseMusicIntent('sad hindi and telugu songs'), [], 2)).toEqual(['hindi sad songs', 'telugu sad songs']);
  });
});

describe('intentTitle', () => {
  it('names a playlist after its language and activity', () => {
    expect(intentTitle(parseMusicIntent('Telugu workout playlist'))).toBe('Telugu Workout Mix');
    expect(intentTitle(parseMusicIntent('sad songs'))).toBe('Heartbreak Mix');
  });
});

describe('8.3.0 — styles in a request', () => {
  it('reads DJ, folk and devotional styles', () => {
    expect(parseMusicIntent('telugu dj songs')).toMatchObject({ languages: ['telugu'], style: 'dj' });
    expect(parseMusicIntent('folk songs').style).toBe('folk');
    expect(parseMusicIntent('janapadalu').style).toBe('folk');
    expect(parseMusicIntent('hindi bhajans').style).toBe('devotional');
    expect(parseMusicIntent('sad tollywood songs').style).toBeNull();
  });

  it('asks the catalogue for the style first, and does not dilute DJ with generic party songs', () => {
    expect(catalogQueries(parseMusicIntent('telugu dj songs'), [], 3)).toEqual(['telugu dj remix', 'telugu remix songs']);
    expect(catalogQueries(parseMusicIntent('folk songs'), ['tamil'], 3)).toEqual(['tamil folk songs']);
    expect(catalogQueries(parseMusicIntent('sad folk songs'), ['telugu'], 3)).toEqual(['telugu folk songs', 'telugu sad songs']);
    expect(catalogQueries(parseMusicIntent('dj remix hindi and punjabi'), [], 4)).toEqual(['hindi dj remix', 'punjabi dj remix', 'hindi remix songs', 'punjabi remix songs']);
  });

  it('8.3.1 — a film called "DJ Tillu" is a name, and the request keeps its own words', () => {
    const tillu = parseMusicIntent('telugu dj tillu movie songs');
    expect(tillu).toMatchObject({ style: null, activity: null });
    expect(catalogQueries(tillu, [], 3)[0]).toBe('dj tillu');
    expect(looksLikeNaturalLanguage('dj tillu songs')).toBe(false);
    expect(parseMusicIntent('dj tillu songs for party')).toMatchObject({ style: null, activity: 'party' });
    // A style with other words: the words are asked for in the style, second.
    expect(catalogQueries(parseMusicIntent('arijit singh dj remix'), ['hindi'], 3)).toEqual(['hindi dj remix', 'arijit singh remix', 'hindi remix songs']);
    expect(catalogQueries(parseMusicIntent('spb devotional songs'), ['kannada'], 2)).toEqual(['kannada devotional songs', 'spb devotional']);
    // A remix turned down names no style.
    expect(parseMusicIntent('arijit singh songs without remix').style).toBeNull();
    // Still a party cue when it asks for the DJ sound.
    expect(parseMusicIntent('telugu dj songs')).toMatchObject({ style: 'dj', activity: 'party' });
  });

  it('names the playlist after the style', () => {
    expect(intentTitle(parseMusicIntent('telugu dj songs'))).toBe('Telugu DJ Remix Mix');
    expect(intentTitle(parseMusicIntent('kannada folk songs'))).toBe('Kannada Folk Mix');
  });
});

describe('8.5.0 — seeds, tempo and instrumental', () => {
  it('reads the seed name without its "but …" modifier, and keeps its words out of the cues', () => {
    expect(seedOf('songs like Blinding Lights')).toEqual({ text: 'Blinding Lights' });
    expect(seedOf('Songs similar to Arijit Singh but more upbeat')).toEqual({ text: 'Arijit Singh' });
    expect(seedOf('music in the style of "Ilaiyaraaja" songs')).toEqual({ text: 'Ilaiyaraaja' });
    for (const none of ['love me like you do', 'more like this', 'something like that', 'telugu sad songs']) expect(seedOf(none), none).toBeNull();
    const i = parseMusicIntent('songs like Love Story');
    expect(i.seed).toEqual({ text: 'Love Story' });
    expect(i.moods).toEqual([]);
    expect(parseMusicIntent('Songs similar to Arijit Singh but more upbeat').energy).toBe('high');
  });

  it('a seed request always reads as a description', () => {
    expect(looksLikeNaturalLanguage('songs like Blinding Lights')).toBe(true);
    expect(looksLikeNaturalLanguage('love me like you do')).toBe(false);
  });

  it('tempo and instrumental pick the probed catalogue phrasings, never "slow songs"', () => {
    const slow = parseMusicIntent('slow acoustic songs');
    expect(slow.tempo).toBe('slow');
    const q = catalogQueries(slow, ['hindi'], 4);
    expect(q.slice(0, 2)).toEqual(['hindi acoustic songs', 'hindi unplugged']);
    for (const x of q) expect(x).not.toMatch(/slow/);
    const inst = parseMusicIntent('Relaxing instrumental music for studying');
    expect(inst.instrumental).toBe(true);
    expect(catalogQueries(inst, ['telugu'], 2)[0]).toBe('telugu instrumental');
    expect(parseMusicIntent('fast hindi songs').tempo).toBe('fast');
  });
});

// 9.1.0 — a length the request asks for.
describe('requested length', () => {
  const lengthOf = (text: string) => parseMusicIntent(text).length;

  it('reads a count of songs', () => {
    expect(lengthOf('15 songs for a drive')).toEqual({ songs: 15, minutes: null });
    expect(lengthOf('give me twenty tracks')).toEqual({ songs: 20, minutes: null });
  });

  it('reads a duration', () => {
    expect(lengthOf('a 45 minute telugu playlist')).toEqual({ songs: null, minutes: 45 });
    expect(lengthOf('about an hour of melodies')).toEqual({ songs: null, minutes: 60 });
    expect(lengthOf('two hours of hindi songs')).toEqual({ songs: null, minutes: 120 });
    expect(lengthOf('half an hour of folk')).toEqual({ songs: null, minutes: 30 });
  });

  it('prefers an exact count over a duration when both are named', () => {
    expect(lengthOf('20 songs, about an hour')).toMatchObject({ songs: 20 });
  });

  it('reads no length from a decade, a year or an unrelated number', () => {
    expect(lengthOf('90s telugu hits')).toBeNull();
    expect(lengthOf('best of 2024')).toBeNull();
    expect(lengthOf('sad songs for a rainy evening')).toBeNull();
  });

  it('refuses an absurd length', () => {
    expect(lengthOf('500 songs')).toBeNull();
    expect(lengthOf('a 2 minute playlist')).toBeNull();
    expect(lengthOf('a 900 minute playlist')).toBeNull();
  });

  it('turns a length into a song count, approximately for a duration', () => {
    expect(requestedSongCount(parseMusicIntent('15 songs'))).toBe(15);
    // An hour at roughly four minutes a song.
    expect(requestedSongCount(parseMusicIntent('about an hour of melodies'))).toBe(15);
    expect(requestedSongCount(parseMusicIntent('sad songs'))).toBeNull();
  });

  it('never asks for more than the cap', () => {
    expect(requestedSongCount(parseMusicIntent('four hours of songs'))).toBeLessThanOrEqual(MAX_REQUESTED_SONGS);
  });
});
