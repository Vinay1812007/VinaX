import { describe, expect, it } from 'vitest';
import { songDesc, songTitle } from './songSeo';

// The same cases as songTitle/songDesc in backend/worker/functions/_lib/render.test.ts:
// the browser and the prerendered page must say the same thing.
describe('song page title and description', () => {
  it('puts the film after the song, like the prerendered page', () => {
    expect(songTitle('Suttamla Soosi', 'Gangs Of Godavari', 'Anurag Kulkarni, Yuvan Shankar Raja', 'telugu')).toBe('Suttamla Soosi - Gangs Of Godavari | Telugu Song | VinaX');
    expect(songTitle('Mahi (From "Deewana")', 'Evergreen Bangla Romantic Movie Songs', 'Prasenjit Mallick', 'bengali')).toBe('Mahi (From "Deewana") | Bengali Song | VinaX');
    expect(songTitle('Aaho Raja', 'Aaho Raja', 'Anirudh Ravichander, Arivu', 'tamil')).toBe('Aaho Raja - Anirudh Ravichander | Tamil Song | VinaX');
  });
  it('describes the song in the words people search with', () => {
    expect(songDesc('Suttamla Soosi', 'Gangs Of Godavari', 'Anurag Kulkarni, Yuvan Shankar Raja', 'telugu')).toBe(
      'Listen to Suttamla Soosi online. Suttamla Soosi is a Telugu song from Gangs Of Godavari, sung by Anurag Kulkarni and Yuvan Shankar Raja. Stream it free on…',
    );
  });
});
