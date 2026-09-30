// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Playlist, Song } from '@/types';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));
vi.mock('@/services/api', () => ({ searchSongs: vi.fn(), searchPlaylists: vi.fn(), getSongSuggestions: vi.fn(async () => []) }));
vi.mock('@/services/ai/embeddings', async (importActual) => {
  const actual = await importActual<typeof import('@/services/ai/embeddings')>();
  return { cosine: actual.cosine, activeEmbeddingModel: () => null, embedQueryDetailed: async () => null, embedSongs: async () => undefined, getCachedEmbedding: () => null };
});

import { getSongSuggestions, searchPlaylists, searchSongs } from '@/services/api';
import { resetSearchReading } from '@/services/ai/searchReading';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { explainMatches, findSemanticMatches } from './semanticSearch';

const song = (id: string, over: Partial<Song> = {}): Song =>
  ({ kind: 'song', id, title: `Song ${id}`, subtitle: '', artists: [], album: null, images: [], audio: [], duration: null, language: 'telugu', year: null, explicit: false, hasLyrics: false, playCount: null, ...over }) as Song;
const playlist = (id: string, title: string, language: string | null = 'telugu'): Playlist =>
  ({ kind: 'playlist', id, title, subtitle: '', images: [], songs: [], songCount: null, language }) as Playlist;

const serverAnswer = vi.fn(async (): Promise<Response> => new Response(JSON.stringify({ error: 'ai_disabled' }), { status: 503 }));

beforeEach(() => {
  resetSearchReading();
  serverAnswer.mockClear();
  serverAnswer.mockImplementation(async () => new Response(JSON.stringify({ error: 'ai_disabled' }), { status: 503 }));
  vi.stubGlobal('fetch', (...args: unknown[]) => serverAnswer(...(args as [])));
  vi.mocked(getSongSuggestions).mockReset();
  vi.mocked(getSongSuggestions).mockResolvedValue([]);
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

describe('8.5.0 — seeds, the server reading and decade filters', () => {
  const none = { results: null, pinned: [] as string[], muted: [] as string[] };

  it('"songs like <a song>" answers with the catalogue\'s similar songs, never the seed or another release of it', async () => {
    const seed = song('seed', { title: 'Blinding Lights', artists: [{ id: 'a', name: 'The Singer' }], language: 'english' });
    vi.mocked(searchSongs).mockImplementation(async (q: string) => (q === 'Blinding Lights' ? [seed] : []));
    vi.mocked(searchPlaylists).mockResolvedValue([]);
    vi.mocked(getSongSuggestions).mockResolvedValue([
      song('copy', { title: 'Blinding Lights', artists: [{ id: 'a', name: 'The Singer' }] }),
      song('sim1', { title: 'Night Drive', artists: [{ id: 'b', name: 'Other' }] }),
      song('sim2', { title: 'Neon Road', artists: [{ id: 'c', name: 'Third' }] }),
    ]);
    const out = await findSemanticMatches('songs like Blinding Lights', none);
    expect(getSongSuggestions).toHaveBeenCalledWith('seed', 20, expect.anything());
    // Catalogue order is kept when nothing else was asked.
    expect(out.songs.map((s) => s.id)).toEqual(['sim1', 'sim2']);
    expect(out.seed).toEqual({ asked: 'Blinding Lights', matched: { kind: 'song', title: 'Blinding Lights', artist: 'The Singer' } });
    expect(explainMatches('songs like Blinding Lights', out.seed)).toBe('Songs like “Blinding Lights” by The Singer, from the catalogue’s similar songs.');
  });

  it('a seed the catalogue does not know is said plainly, and the words are searched as usual', async () => {
    vi.mocked(searchSongs).mockResolvedValue([song('x1', { title: 'Unrelated' })]);
    vi.mocked(searchPlaylists).mockResolvedValue([]);
    const out = await findSemanticMatches('songs like Nothing Real', none);
    expect(getSongSuggestions).not.toHaveBeenCalled();
    expect(out.seed).toEqual({ asked: 'Nothing Real', matched: null });
    expect(explainMatches('songs like Nothing Real', out.seed)).toMatch(/isn’t in the catalogue/);
  });

  it('the server\'s AI reading adds a mood the word lists missed, and its catalogue phrase is fetched', async () => {
    serverAnswer.mockImplementation(async () => new Response(JSON.stringify({ source: 'ai', filters: { languages: ['tamil'], moods: ['romantic'], songs: [{ id: 'invented' }] } }), { status: 200 }));
    vi.mocked(searchSongs).mockImplementation(async (q: string) => (q === 'tamil romantic songs' ? [song('ta-love', { language: 'tamil', title: 'Kadhal' })] : []));
    vi.mocked(searchPlaylists).mockResolvedValue([]);
    const out = await findSemanticMatches('something for a candle light dinner', none);
    const queries = vi.mocked(searchSongs).mock.calls.map((c) => c[0]);
    expect(queries).toContain('tamil romantic songs');
    expect(out.songs.map((s) => s.id)).toContain('ta-love');
    expect(out.songs.map((s) => s.id)).not.toContain('invented');
    const sent = JSON.parse(String((serverAnswer.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent).toMatchObject({ query: 'something for a candle light dinner', withTracks: false });
  });

  it('a named decade filters by year when enough songs carry one', async () => {
    const years = ['2001', '2003', '2005', '2007', '2009', '1995', '2015'];
    vi.mocked(searchSongs).mockResolvedValue(years.map((y) => song(`y${y}`, { year: y, mood: 'melancholy' })));
    vi.mocked(searchPlaylists).mockResolvedValue([]);
    const out = await findSemanticMatches('sad telugu songs from the 2000s', none);
    expect(out.songs.map((s) => s.year).sort()).toEqual(['2001', '2003', '2005', '2007', '2009']);
  });

  it('the AI switch off means no server call at all', async () => {
    const { useSettingsStore } = await import('@/store/settingsStore');
    useSettingsStore.setState({ aiAssist: false });
    vi.mocked(searchSongs).mockResolvedValue([]);
    vi.mocked(searchPlaylists).mockResolvedValue([]);
    await findSemanticMatches('sad telugu songs for rain', none);
    expect(serverAnswer).not.toHaveBeenCalled();
    useSettingsStore.setState({ aiAssist: true });
  });
});
