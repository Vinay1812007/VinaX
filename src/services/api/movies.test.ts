import { describe, it, expect } from 'vitest';
import { filmTitleFromAlbumName } from './movies';

describe('filmTitleFromAlbumName', () => {
  it('extracts a (From "Film") title', () => {
    expect(filmTitleFromAlbumName('Boom Boom (From "Dude (Telugu)")')).toBe('Dude');
  });
  it('keeps inner quotes/typographic quotes', () => {
    expect(filmTitleFromAlbumName('Aaya Sher (From “The Paradise”)')).toBe('The Paradise');
  });
  it('extracts an OST-style title', () => {
    expect(filmTitleFromAlbumName('Pushpa 2 The Rule (Original Motion Picture Soundtrack)')).toBe(
      'Pushpa 2 The Rule',
    );
  });
  it('strips a trailing language marker from the film name', () => {
    expect(filmTitleFromAlbumName('Suttamla Soosi (From "Gangs Of Godavari (Telugu)")')).toBe(
      'Gangs Of Godavari',
    );
  });
  it('returns null for plain albums', () => {
    expect(filmTitleFromAlbumName('Greatest Hits Vol. 2')).toBeNull();
    expect(filmTitleFromAlbumName('')).toBeNull();
  });
});
