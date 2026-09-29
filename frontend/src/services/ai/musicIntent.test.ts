import { describe, expect, it } from 'vitest';
import { catalogQueries, intentTitle, looksLikeNaturalLanguage, parseMusicIntent } from './musicIntent';

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
