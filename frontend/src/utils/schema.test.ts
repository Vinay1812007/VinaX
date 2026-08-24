/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { bcp47, buildAlbumJsonLd, buildArtistBreadcrumbs, buildArtistJsonLd, buildSongBreadcrumbs, buildSongJsonLd, isoDuration, SITE_ORIGIN } from './schema';
import type { Album, Artist, Song } from '@/types/music';

const song: Song = {
  kind: 'song',
  id: 'S1',
  title: 'Test Song!',
  subtitle: 'Test Artist',
  artists: [{ id: 'A1', name: 'Test Artist' }],
  album: { id: 'AL1', name: 'Test Album' },
  images: [{ quality: '500x500', url: 'https://img.example/500.jpg' }],
  audio: [],
  duration: 245,
  language: 'telugu',
  year: '2024',
  explicit: false,
  hasLyrics: true,
  playCount: null,
};

const album: Album = {
  kind: 'album',
  id: 'AL1',
  title: 'Test Album',
  subtitle: 'Test Artist',
  images: [{ quality: '500x500', url: 'https://img.example/al.jpg' }],
  artists: [{ id: 'A1', name: 'Test Artist' }],
  songs: [song],
  songCount: 1,
  year: '2024',
  language: 'hindi',
};

const artist: Artist = {
  kind: 'artist',
  id: 'A1',
  name: 'Test Artist',
  subtitle: 'Artist',
  images: [],
  bio: null,
  topSongs: [song],
  albums: [],
};

describe('schema.org builders', () => {
  it('maps catalog languages to BCP-47 and formats ISO durations', () => {
    expect(bcp47('telugu')).toBe('te');
    expect(bcp47('hindi')).toBe('hi');
    expect(bcp47('klingon')).toBe('klingon');
    expect(bcp47(null)).toBeUndefined();
    expect(isoDuration(245)).toBe('PT4M5S');
    expect(isoDuration(60)).toBe('PT1M0S');
    expect(isoDuration(0)).toBeUndefined();
    expect(isoDuration(null)).toBeUndefined();
  });

  it('builds a MusicRecording with slugged canonical URLs and anchored @ids', () => {
    const ld = JSON.parse(JSON.stringify(buildSongJsonLd(song))) as Record<string, any>;
    expect(ld['@type']).toBe('MusicRecording');
    expect(ld.url).toBe(`${SITE_ORIGIN}/song/test-song-S1`);
    expect(ld['@id']).toBe(`${SITE_ORIGIN}/song/test-song-S1#recording`);
    expect(ld.duration).toBe('PT4M5S');
    expect(ld.inLanguage).toBe('te');
    expect(ld.byArtist[0]['@id']).toBe(`${SITE_ORIGIN}/artist/test-artist-A1#artist`);
    expect(ld.inAlbum['@id']).toBe(`${SITE_ORIGIN}/album/test-album-AL1#album`);
    expect(ld.isPartOf['@id']).toBe(`${SITE_ORIGIN}/#website`);
  });

  it('drops empty fields after serialization instead of emitting nulls', () => {
    const bare: Song = { ...song, duration: null, year: null, language: null, album: null };
    const ld = JSON.parse(JSON.stringify(buildSongJsonLd(bare))) as Record<string, unknown>;
    expect('duration' in ld).toBe(false);
    expect('datePublished' in ld).toBe(false);
    expect('inLanguage' in ld).toBe(false);
    expect('inAlbum' in ld).toBe(false);
  });

  it('builds a MusicAlbum with a bounded track ItemList', () => {
    const ld = JSON.parse(JSON.stringify(buildAlbumJsonLd(album))) as Record<string, any>;
    expect(ld['@type']).toBe('MusicAlbum');
    expect(ld.url).toBe(`${SITE_ORIGIN}/album/test-album-AL1`);
    expect(ld.numTracks).toBe(1);
    expect(ld.track.itemListElement).toHaveLength(1);
    expect(ld.track.itemListElement[0].position).toBe(1);
    expect(ld.inLanguage).toBe('hi');
  });

  it('builds a MusicGroup with top tracks capped at 10', () => {
    const many: Artist = { ...artist, topSongs: Array.from({ length: 15 }, (_, i) => ({ ...song, id: `S${i}` })) };
    const ld = JSON.parse(JSON.stringify(buildArtistJsonLd(many))) as Record<string, any>;
    expect(ld['@type']).toBe('MusicGroup');
    expect(ld.track).toHaveLength(10);
    expect(ld['@id']).toBe(`${SITE_ORIGIN}/artist/test-artist-A1#artist`);
  });
});

describe('breadcrumbs', () => {
  it('builds Home › hub › album › song with sequential positions', () => {
    const ld = JSON.parse(JSON.stringify(buildSongBreadcrumbs(song))) as Record<string, any>;
    const items = ld.itemListElement;
    expect(items).toHaveLength(4);
    expect(items.map((i: any) => i.position)).toEqual([1, 2, 3, 4]);
    expect(items[1].name).toBe('Telugu Songs');
    expect(items[1].item).toBe(`${SITE_ORIGIN}/telugu-songs`);
    expect(items[2].item).toBe(`${SITE_ORIGIN}/album/test-album-AL1`);
    expect(items[3].name).toBe('Test Song!');
    expect('item' in items[3]).toBe(false);
  });

  it('omits the hub crumb for languages without a hub page', () => {
    const ld = JSON.parse(JSON.stringify(buildSongBreadcrumbs({ ...song, language: 'sanskrit', album: null }))) as Record<string, any>;
    expect(ld.itemListElement).toHaveLength(2);
  });

  it('keeps artist trails minimal', () => {
    const ld = JSON.parse(JSON.stringify(buildArtistBreadcrumbs(artist))) as Record<string, any>;
    expect(ld.itemListElement).toHaveLength(2);
    expect(ld.itemListElement[1].name).toBe('Test Artist');
  });
});
