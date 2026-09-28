// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Playlist, Song } from '@/types';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));
vi.mock('@/services/api', () => ({ searchSongs: vi.fn(), searchPlaylists: vi.fn() }));
vi.mock('@/services/ai/embeddings', async (importActual) => {
  const actual = await importActual<typeof import('@/services/ai/embeddings')>();
  return { cosine: actual.cosine, activeEmbeddingModel: () => null, embedQueryDetailed: async () => null, embedSongs: async () => undefined, getCachedEmbedding: () => null };
});

import { searchPlaylists, searchSongs } from '@/services/api';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { findSemanticMatches } from './semanticSearch';

const song = (id: string, over: Partial<Song> = {}): Song =>
  ({ kind: 'song', id, title: `Song ${id}`, subtitle: '', artists: [], album: null, images: [], audio: [], duration: null, language: 'telugu', year: null, explicit: false, hasLyrics: false, playCount: null, ...over }) as Song;
const playlist = (id: string, title: string, language: string | null = 'telugu'): Playlist =>
  ({ kind: 'playlist', id, title, subtitle: '', images: [], songs: [], songCount: null, language }) as Playlist;

beforeEach(() => {
  vi.mocked(searchSongs).mockReset();
  vi.mocked(searchPlaylists).mockReset();
  useLibraryStore.setState({ favorites: [], hiddenSongIds: [], hiddenArtists: [] });
  useHistoryStore.setState({ entries: [] });
});

describe('findSemanticMatches', () => {
  it('ranks results, library and catalogue songs against a description, keeping to the named language', async () => {
    const liked = song('liked-sad', { mood: 'melancholy', artists: [{ id: 'sid', name: 'Sid Sriram' }] });
    useLibraryStore.setState({ favorites: [liked] });
    vi.mocked(searchSongs).mockImplementation(async (q: string) =>
      q === 'telugu sad songs'
        ? [song('cat-sad', { mood: 'melancholy', artists: [{ id: 'sid', name: 'Sid Sriram' }] }), song('cat-2'), song('cat-3'), song('cat-4')]
        : [song('cat-dance', { mood: 'energetic', title: 'Dance Number', artists: [{ id: 'dsp', name: 'Devi Sri Prasad' }] })],
    );
    vi.mocked(searchPlaylists).mockResolvedValue([playlist('p-party', 'Telugu Party Hits'), playlist('p-sad', 'Sad Telugu Melodies'), playlist('p-hindi', 'Sad Hindi', 'hindi')]);
    const out = await findSemanticMatches('sad telugu songs for rain', {
      results: { songs: [song('hindi-party', { language: 'hindi', title: 'Party' })], albums: [], artists: [], playlists: [] },
      pinned: ['hindi'],
      muted: [],
    });
    const queries = vi.mocked(searchSongs).mock.calls.map((c) => c[0]);
    expect(queries[0]).toBe('telugu sad songs');
    expect(out.songs.map((s) => s.id)).not.toContain('hindi-party');
    expect(out.songs.slice(0, 2).map((s) => s.id).sort()).toEqual(['cat-sad', 'liked-sad']);
    expect(out.artists[0]).toMatchObject({ id: 'sid', name: 'Sid Sriram' });
    expect(out.playlists.map((p) => p.id)).not.toContain('p-hindi');
    expect(out.playlists[0].id).toBe('p-sad');
    expect(out.space).toBe('local');
  });

  it('drops muted languages and survives a failing catalogue', async () => {
    vi.mocked(searchSongs).mockRejectedValue(new Error('down'));
    vi.mocked(searchPlaylists).mockRejectedValue(new Error('down'));
    const out = await findSemanticMatches('chill songs for sleep', {
      results: { songs: [song('ta', { language: 'tamil' }), song('te', { mood: 'chill' })], albums: [], artists: [], playlists: [] },
      pinned: [],
      muted: ['tamil'],
    });
    expect(out.songs.map((s) => s.id)).toEqual(['te']);
  });
});
