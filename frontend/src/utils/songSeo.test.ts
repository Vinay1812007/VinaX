import { describe, expect, it } from 'vitest';
import { albumDesc, albumTitle, artistDesc, artistTitle, mainLanguage, songDesc, songTitle } from './songSeo';

// The same cases as songTitle/songDesc in backend/worker/functions/_lib/render.test.ts:
// the browser and the prerendered page must say the same thing.
describe('song page title and description', () => {
  it('puts the film after the song, like the prerendered page', () => {
    expect(songTitle('Raavana', 'Jai Lava Kusa', 'Divya Kumar', 'telugu')).toBe('Raavana - Song by Divya Kumar | Jai Lava Kusa | VinaX');
    expect(songTitle('Suttamla Soosi', 'Gangs Of Godavari', 'Anurag Kulkarni, Yuvan Shankar Raja', 'telugu')).toBe('Suttamla Soosi - Song by Anurag Kulkarni | Gangs Of Godavari | VinaX');
    expect(songTitle('Mahi (From "Deewana")', 'Evergreen Bangla Romantic Movie Songs', 'Prasenjit Mallick', 'bengali')).toBe('Mahi (From "Deewana") - Song by Prasenjit Mallick | VinaX') // 71 with the language;
    expect(songTitle('Aaho Raja', 'Aaho Raja', 'Anirudh Ravichander, Arivu', 'tamil')).toBe('Aaho Raja - Song by Anirudh Ravichander and Arivu | Tamil Song | VinaX');
    expect(songTitle('Coolie Disco (From "Coolie")', 'Coolie Disco (From "Coolie")', 'Anirudh Ravichander', 'tamil')).toBe('Coolie Disco (From "Coolie") - Song by Anirudh Ravichander | VinaX');
    expect(songTitle('Shape of You', '÷', 'Ed Sheeran', 'english')).toBe('Shape of You - Song by Ed Sheeran | English Song | VinaX');
    expect(songTitle('Chandaniya (From "Master of Melody") (feat. Ashish Chanchlani and Ruhani Sharma)', 'Master of Melody', 'Sachet Tandon', 'hindi')).toBe('Chandaniya - Song by Sachet Tandon | Master of Melody | VinaX');
    expect(songTitle('Bikhre Khwab Hindi Song Sad Love Song Heartbreak Song Broken Heart Lofi Version 2026', null, 'A', 'hindi')).toBe('Bikhre Khwab Hindi Song Sad Love Song Heartbreak Song… | VinaX');
  });
  it('describes the song in the words people search with', () => {
    expect(songDesc('Raavana', 'Jai Lava Kusa', 'Divya Kumar', 'telugu', '2017', 258)).toBe(
      'Listen to Raavana online. Raavana is a Telugu language song and is sung by Divya Kumar. Raavana, from the album Jai Lava Kusa, was released in the year 2017.',
    );
    expect(songDesc('Suttamla Soosi', 'Gangs Of Godavari', 'Anurag Kulkarni, Yuvan Shankar Raja', 'telugu')).toBe(
      'Listen to Suttamla Soosi online. Suttamla Soosi is a Telugu language song and is sung by Anurag Kulkarni and Yuvan Shankar Raja.',
    );
    expect(songDesc('Aaho Raja', 'Aaho Raja', undefined, 'english', 2024, 200)).toBe(
      'Listen to Aaho Raja online. Aaho Raja is an English language song. It was released in the year 2024. The duration of the song is 3:20.',
    );
  });
});

describe('album and artist page titles, as on the prerendered page', () => {
  it('names albums as people search for them', () => {
    expect(albumTitle('Jailer 2 (Original Motion Picture Soundtrack)', '2026', 'tamil')).toBe('Jailer 2 Songs - Tamil Movie Songs 2026 | VinaX');
    expect(albumTitle('Gangs Of Godavari', '2024', 'telugu', true)).toBe('Gangs Of Godavari Songs - Telugu Movie Songs 2024 | VinaX');
    expect(albumTitle('AUJLA SZN 1', '2026', 'punjabi')).toBe('AUJLA SZN 1 Songs - Punjabi Album 2026 | VinaX');
    expect(albumDesc('AUJLA SZN 1', '2026', 'punjabi', ['Ashke', 'Real Bad Man', 'Straight Up', 'One More'])).toBe(
      'Listen to AUJLA SZN 1 songs online. AUJLA SZN 1 is a Punjabi album released in 2026. There are a total of 4 songs in AUJLA SZN 1. Stream free on VinaX.',
    );
  });
  it('names artists by their songs and main language', () => {
    expect(mainLanguage([{ language: 'hindi' }, { language: 'hindi' }, { language: 'punjabi' }, { language: null }])).toBe('hindi');
    expect(artistTitle('Arijit Singh', 'hindi')).toBe('Arijit Singh Songs - Top Hindi Hits | VinaX');
    expect(artistDesc('Arijit Singh', ['Tu Mil Jaaye (From "KING")', 'Tum Hi Ho'])).toBe('Listen to Arijit Singh songs online: Tu Mil Jaaye, Tum Hi Ho and more. Stream free on VinaX.');
  });
});
