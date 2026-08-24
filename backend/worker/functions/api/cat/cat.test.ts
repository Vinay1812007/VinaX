/**
 * Pins the self-hosted catalog's mapping contract (4.20.0): raw JioSaavn v4
 * objects pass through with `name`, flattened `primaryArtists`, and
 * play-time-resolved downloadUrl entries pointing at /api/cat/stream —
 * exactly the wrapper dialect src/services/api/normalize.ts consumes.
 */
import { describe, expect, it } from 'vitest';
import { mapSong, streamUrls } from './[[path]]';

const ORIGIN = 'https://www.sirimillavinay.online';
const RAW = {
  id: 'abc123',
  title: 'Naatu Naatu',
  subtitle: 'Rahul Sipligunj, Kaala Bhairava',
  image: 'https://c.saavncdn.com/x/RRR-150x150.jpg',
  language: 'telugu',
  year: '2022',
  play_count: '1000',
  more_info: {
    album: 'RRR',
    duration: '212',
    encrypted_media_url: 'ENCRYPTED+BLOB==',
    artistMap: { primary_artists: [{ id: 'a1', name: 'Rahul Sipligunj' }, { id: 'a2', name: 'Kaala Bhairava' }] },
  },
};

describe('mapSong', () => {
  it('adds name, flattened primaryArtists and stream-resolver downloadUrl', () => {
    const s = mapSong(RAW, ORIGIN);
    expect(s.name).toBe('Naatu Naatu');
    expect(s.primaryArtists).toBe('Rahul Sipligunj, Kaala Bhairava');
    expect(s.downloadUrl).toHaveLength(4);
    expect(s.downloadUrl[3]).toStrictEqual({
      quality: '320kbps',
      url: `${ORIGIN}/api/cat/stream?e=ENCRYPTED%2BBLOB%3D%3D&q=320`,
    });
    // Raw v4 fields normalize.ts reads survive untouched.
    expect(s.more_info.artistMap.primary_artists[0].name).toBe('Rahul Sipligunj');
    expect(s.language).toBe('telugu');
  });
  it('is defensive on junk and songs without an encrypted url', () => {
    expect(mapSong(null, ORIGIN)).toBeNull();
    expect(streamUrls({}, ORIGIN)).toStrictEqual([]);
    expect(mapSong({ id: 'x', title: 'T' }, ORIGIN).downloadUrl).toStrictEqual([]);
  });
});
