import { describe, expect, it } from 'vitest';
import { moodPageSeo } from '@/constants/seoPages';
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
    // A compilation is not a film: the singer and language stay (live pages, 2026-11-23).
    expect(songTitle('Phir Bhi Tumko Chaahunga', 'World Music Day 2026', 'Manoj Muntashir, Mithoon, Arijit Singh, Shashaa Tirupati', 'hindi')).toBe('Phir Bhi Tumko Chaahunga - Song by Manoj Muntashir and Mithoon | VinaX');
    expect(songTitle('Apna Bana Le', 'Wedding Love Songs', 'Amitabh Bhattacharya, Sachin-Jigar, Arijit Singh', 'hindi')).toBe('Apna Bana Le - Song by Amitabh Bhattacharya and Sachin-Jigar | VinaX');
    expect(songTitle('Ve Maahi', 'Romance Trending Now', 'Arijit Singh, Asees Kaur', 'hindi')).toBe('Ve Maahi - Song by Arijit Singh and Asees Kaur | Hindi Song | VinaX');
    // A year alone is not a compilation: "1942: A Love Story" and "2018" are films.
    expect(songTitle('Ek Ladki Ko Dekha', '1942: A Love Story', 'Kumar Sanu', 'hindi')).toBe('Ek Ladki Ko Dekha - Song by Kumar Sanu | 1942: A Love Story | VinaX');
    expect(songTitle('Vennelave', '2018', 'Kailas Menon', 'malayalam')).toBe('Vennelave - Song by Kailas Menon | 2018 | VinaX');
    expect(songDesc('Phir Bhi Tumko Chaahunga', 'World Music Day 2026', 'Manoj Muntashir, Mithoon, Arijit Singh, Shashaa Tirupati', 'hindi')).toBe(
      'Listen to Phir Bhi Tumko Chaahunga online. Phir Bhi Tumko Chaahunga is a Hindi language song and is sung by Manoj Muntashir, Mithoon, Arijit Singh and more.',
    );
    expect(songDesc('Pal Pal Dil Ke Paas- Title Track', 'World Music Day 2026', 'Siddharth-Garima, Arijit Singh, Parampara Thakur, Sachet Tandon', 'hindi', 2019, 200)).toBe(
      'Pal Pal Dil Ke Paas- Title Track is a Hindi language song and is sung by Siddharth-Garima, Arijit Singh, Parampara Thakur and more.',
    ); // too long with "Listen to … online.", so that sentence goes, not the singers
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

describe('mood pages, as on the prerendered page', () => {
  it('uses the same words as render.ts moodTitle/moodDesc', () => {
    expect(moodPageSeo('Telugu', 'Romantic', 'love songs and melodies for every heartbeat', 2026)).toEqual({
      t: 'Telugu Romantic Songs 2026 - Best Telugu Romantic Hits | VinaX',
      d: 'Listen to the best Telugu romantic songs of 2026 online: love songs and melodies for every heartbeat. Stream them free on VinaX, with no subscription.',
    });
    expect(moodPageSeo('Malayalam', 'Devotional', 'bhajans and devotional classics', 2026).t).toBe('Malayalam Devotional Songs 2026 - Best Devotional Hits | VinaX');
    // A first sentence past 160 characters is cut at a word, as moodDesc's fitDesc cuts it at the edge.
    const long = moodPageSeo('Bhojpuri', 'Devotional', 'bhajans, aartis, chalisas, Chhath geet, Navratri songs, Shiv bhajans and the devotional classics every home plays', 2026).d;
    expect(long).toBe('Listen to the best Bhojpuri devotional songs of 2026 online: bhajans, aartis, chalisas, Chhath geet, Navratri songs, Shiv bhajans and the devotional…');
    expect(long.length).toBeLessThanOrEqual(160);
  });
});
