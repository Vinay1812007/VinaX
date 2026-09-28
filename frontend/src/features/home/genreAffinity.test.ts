import { describe, expect, it } from 'vitest';
import { canonicalGenre, genreAffinityStrength, rankGenres, rankGenreTiles, topGenreShelves } from './genreAffinity';
import { GENRE_SHELVES } from './useGenreShelves';

describe('genre affinity for Home', () => {
  it('folds aliases into one canonical genre and ranks by summed affinity', () => {
    expect(canonicalGenre('Melody')).toBe('romantic');
    expect(canonicalGenre('EDM')).toBe('dance');
    expect(canonicalGenre('film')).toBeNull();
    expect(rankGenres({ romantic: 3, love: 2, dance: 4, film: 99, rock: -1 })).toEqual([
      { id: 'romantic', score: 5 },
      { id: 'dance', score: 4 },
    ]);
  });

  it('turns the top genres into short catalogue queries in the listener language', () => {
    const picks = topGenreShelves({ romantic: 6, dance: 3, devotional: 2.5 }, 'telugu', 2);
    expect(picks.map((p) => p.query)).toEqual(['telugu melody songs', 'telugu dance songs']);
    expect(picks.map((p) => p.label)).toEqual(['Melody', 'Dance']);
    // Every query is "<language> <word> songs" — never a long invented phrase.
    for (const p of picks) expect(p.query.split(' ')).toHaveLength(3);
  });

  it('shows nothing for a cold profile and drops an unknown language prefix', () => {
    expect(topGenreShelves({}, 'hindi')).toEqual([]);
    expect(topGenreShelves({ rock: 1 }, 'hindi')).toEqual([]);
    expect(topGenreShelves({ rock: 5 }, 'unknown')[0].query).toBe('rock songs');
    expect(topGenreShelves({ 'hip-hop': 5 }, null)[0].query).toBe('rap songs');
  });

  it('measures how concentrated the taste is', () => {
    expect(genreAffinityStrength({})).toBe(0);
    expect(genreAffinityStrength({ romantic: 3, dance: 1 })).toBeCloseTo(0.75);
  });

  it('puts the genre and language tiles the listener leans towards first, others keep their order', () => {
    const ranked = rankGenreTiles(GENRE_SHELVES, { dance: 5, 'hip-hop': 2 }, { telugu: 10 });
    expect(ranked.slice(0, 3).map((t) => t.id)).toEqual(['edm', 'telugu', 'hiphop']);
    expect(ranked).toHaveLength(GENRE_SHELVES.length);
    const rest = ranked.slice(3).map((t) => t.id);
    expect(rest).toEqual(GENRE_SHELVES.map((t) => t.id).filter((id) => !['edm', 'telugu', 'hiphop'].includes(id)));
    // No affinity at all: the original order.
    expect(rankGenreTiles(GENRE_SHELVES, {}, {})).toEqual(GENRE_SHELVES);
  });
});
