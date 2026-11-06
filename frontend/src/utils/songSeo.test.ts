import { describe, expect, it } from 'vitest';
import { albumDesc, albumTitle, artistDesc, artistTitle, mainLanguage, songDesc, songTitle } from './songSeo';

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

describe('album and artist page titles, as on the prerendered page', () => {
  it('names albums as people search for them', () => {
    expect(albumTitle('Jailer 2 (Original Motion Picture Soundtrack)', '2026', 'tamil')).toBe('Jailer 2 Songs - Tamil Movie Songs 2026 | VinaX');
    expect(albumTitle('Gangs Of Godavari', '2024', 'telugu', true)).toBe('Gangs Of Godavari Songs - Telugu Movie Songs 2024 | VinaX');
    expect(albumTitle('AUJLA SZN 1', '2026', 'punjabi')).toBe('AUJLA SZN 1 Songs - Punjabi Album 2026 | VinaX');
    expect(albumDesc('AUJLA SZN 1', '2026', 'punjabi', ['Ashke', 'Real Bad Man', 'Straight Up', 'One More'])).toBe(
      'Listen to all 4 AUJLA SZN 1 songs online, a Punjabi album: Ashke, Real Bad Man, Straight Up and more. Stream free on VinaX.',
    );
  });
  it('names artists by their songs and main language', () => {
    expect(mainLanguage([{ language: 'hindi' }, { language: 'hindi' }, { language: 'punjabi' }, { language: null }])).toBe('hindi');
    expect(artistTitle('Arijit Singh', 'hindi')).toBe('Arijit Singh Songs - Top Hindi Hits | VinaX');
    expect(artistDesc('Arijit Singh', ['Tu Mil Jaaye (From "KING")', 'Tum Hi Ho'])).toBe('Listen to Arijit Singh songs online: Tu Mil Jaaye, Tum Hi Ho and more. Stream free on VinaX.');
  });
});
