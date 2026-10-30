import { beforeEach, expect, it, vi } from 'vitest';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./client', () => ({ orchestratedRequest: request }));
import {
  episodeToSong,
  getBrowseCategories,
  getCharts,
  getHomeFeed,
  getPodcastEpisodes,
  getPodcasts,
  getRadioStations,
  getSimilarArtists,
  getTopSearches,
  getTrending,
  getTrendingSongs,
  languageParam,
  nextStationSongs,
  startArtistRadio,
} from './catalog';
import { normalizeLyrics } from './normalize';
import { getLyrics } from './saavn';

const img = [
  { quality: '50x50', url: 'https://c.saavncdn.com/a-50x50.jpg' },
  { quality: '500x500', url: 'https://c.saavncdn.com/a-500x500.jpg' },
];
const song = (id: string) => ({
  id,
  name: `Song ${id}`,
  type: 'song',
  language: 'hindi',
  duration: 200,
  artists: { primary: [{ id: '1', name: 'Arijit Singh', image: img }] },
  image: img,
  downloadUrl: [{ quality: '320kbps', url: `https://aac.saavncdn.com/${id}_320.mp4` }],
});
const playlist = (id: string) => ({ id, name: `List ${id}`, type: 'playlist', image: img, songCount: 10 });

/** Run the validator the client would run on a payload. */
function answer(payload: unknown) {
  request.mockImplementation(({ validate }) => {
    const v = validate(payload);
    return v === null ? Promise.reject(new Error('miss')) : Promise.resolve(v);
  });
}

beforeEach(() => {
  request.mockReset();
});

it('sends only supported languages, at most three, defaulting to hindi', () => {
  expect(languageParam(['Telugu', 'hindi', 'klingon', 'tamil', 'english'])).toBe('telugu,hindi,tamil');
  expect(languageParam([])).toBe('hindi');
  expect(languageParam(['klingon'])).toBe('hindi');
  expect(languageParam('punjabi')).toBe('punjabi');
});

it('reads the trending feed and asks with the language list and clamped limit', async () => {
  answer({ success: true, data: { songs: [song('a')], albums: [], playlists: [playlist('p')] } });
  const t = await getTrending(['telugu', 'hindi'], 500);
  expect(request.mock.calls[0][0].paths).toEqual(['/trending?language=telugu%2Chindi&limit=50']);
  expect(t.songs.map((s) => s.id)).toEqual(['a']);
  expect(t.songs[0].audio[0].url).toContain('_320.mp4');
  expect(t.playlists[0].title).toBe('List p');
});

it('treats an empty section as a miss so callers fall back', async () => {
  answer({ success: true, data: [] });
  await expect(getTrendingSongs(['hindi'])).rejects.toThrow();
  answer({ success: true, data: [] });
  await expect(getCharts(['hindi'])).rejects.toThrow();
  answer({ success: false, message: 'not found' });
  await expect(getTrending(['hindi'])).rejects.toThrow();
});

it('maps the home feed', async () => {
  answer({
    success: true,
    data: { newReleases: { songs: [song('n')], albums: [] }, charts: [playlist('c')], featuredPlaylists: [playlist('f')] },
  });
  const h = await getHomeFeed(['hindi']);
  expect(h.newSongs[0].id).toBe('n');
  expect(h.charts[0].id).toBe('c');
  expect(h.featuredPlaylists[0].id).toBe('f');
});

it('maps moods and genres, skipping rows without an id or name', async () => {
  answer({
    success: true,
    data: [
      { id: '27', name: 'Romance', category: 'mood', tags: ['Romantic'], isNew: false, image: img },
      { id: '', name: 'Broken' },
      { id: 31, name: 'Hip Hop', category: 'genre', tags: [], isNew: true, image: [] },
    ],
  });
  const list = await getBrowseCategories(['hindi']);
  expect(list.map((c) => [c.id, c.name, c.category, c.isNew])).toEqual([
    ['27', 'Romance', 'mood', false],
    ['31', 'Hip Hop', 'genre', true],
  ]);
});

it('maps radio stations and keeps only safe colours', async () => {
  answer({
    success: true,
    data: [
      { name: 'Retro Spin', description: 'Hindi Radio', language: 'hindi', color: '#919191', image: img },
      { name: 'Odd', language: 'tamil', color: 'red;background:url(x)' },
    ],
  });
  const st = await getRadioStations(['hindi']);
  expect(st[0].color).toBe('#919191');
  expect(st[1].color).toBeNull();
});

it('opens artist radio without memoising, and continues a station', async () => {
  answer({ success: true, data: { stationId: 'st1', songs: [song('r')] } });
  const s = await startArtistRadio('459320', 99);
  expect(s).toMatchObject({ stationId: 'st1' });
  const req = request.mock.calls[0][0];
  expect(req.paths).toEqual(['/artists/459320/radio?limit=30']);
  expect(req.cacheMs).toBeUndefined();
  answer({ success: true, data: { songs: [song('x')] } });
  expect((await nextStationSongs('st1')).map((x) => x.id)).toEqual(['x']);
});

it('reads similar artists with their largest image', async () => {
  answer({ success: true, data: [{ id: '640931', name: 'Sachin Sanghvi', image: img }] });
  expect(await getSimilarArtists('1')).toEqual([
    { id: '640931', name: 'Sachin Sanghvi', image: 'https://c.saavncdn.com/a-500x500.jpg' },
  ]);
});

it('keeps only known top-search kinds', async () => {
  answer({
    success: true,
    data: [
      { id: 's1', name: 'Parvati', type: 'song', image: img },
      { id: 'x', name: 'Odd', type: 'show' },
      { id: 'a1', name: 'Arijit Singh', type: 'artist', image: img },
    ],
  });
  expect((await getTopSearches(['hindi'])).map((t) => t.type)).toEqual(['song', 'artist']);
});

const episode = {
  id: '3zKcXONr',
  name: 'Himesh Reshammiya',
  type: 'episode',
  podcast: { id: '62', name: 'Talking Music' },
  releaseDate: '2023-03-17',
  duration: 1855,
  language: 'hindi',
  artists: [{ id: '2673255', name: 'Kirthi Shetty', role: 'Host' }],
  image: img,
  downloadUrl: [{ quality: 'original', url: 'https://aac.saavncdn.com/ep.mp3' }],
};

it('turns a podcast episode into a playable song', () => {
  const s = episodeToSong(episode);
  expect(s).toMatchObject({
    kind: 'song',
    id: '3zKcXONr',
    subtitle: 'Kirthi Shetty',
    album: { id: '62', name: 'Talking Music' },
    duration: 1855,
    year: '2023',
  });
  expect(s?.audio).toEqual([{ quality: 'original', url: 'https://aac.saavncdn.com/ep.mp3' }]);
  expect(episodeToSong({ ...episode, downloadUrl: [] })).toBeNull();
});

it('pages podcasts: empty first page is a miss, empty later page is the end', async () => {
  answer({ success: true, data: [] });
  await expect(getPodcasts(1)).rejects.toThrow();
  answer({ success: true, data: [] });
  expect(await getPodcasts(3)).toEqual([]);
  answer({ success: true, data: [episode] });
  const eps = await getPodcastEpisodes('62', { season: 3, page: 2, limit: 5 });
  expect(request.mock.calls[request.mock.calls.length - 1][0].paths).toEqual(['/podcasts/62/episodes?page=2&limit=5&season=3']);
  expect(eps).toHaveLength(1);
});

it('asks for lyrics in English letters only when told to', async () => {
  answer({ success: true, data: { lyrics: 'a', copyright: null } });
  await getLyrics('s1');
  expect(request.mock.calls[0][0].paths[0]).toBe('/songs/s1/lyrics?synced=true');
  await getLyrics('s1', { script: 'latin' });
  expect(request.mock.calls[1][0].paths[0]).toBe('/songs/s1/lyrics?synced=true&script=latin');
  // Bases that do not know the flags still answer the plain route.
  expect(request.mock.calls[1][0].paths.slice(1)).toEqual(['/songs/s1/lyrics', '/lyrics?id=s1']);
});

it('reads synced lyric lines from the lyrics payload', () => {
  const l = normalizeLyrics({
    lyrics: 'a\nb',
    copyright: null,
    synced: { lrc: '[00:01.00]a', lines: [{ time: 1, text: 'a' }, { time: 'x', text: 'bad' }, { time: 2.5, text: 'b' }] },
  });
  expect(l?.synced).toEqual([
    { t: 1, text: 'a' },
    { t: 2.5, text: 'b' },
  ]);
  expect(normalizeLyrics({ lyrics: 'a', synced: null })?.synced).toBeNull();
});
