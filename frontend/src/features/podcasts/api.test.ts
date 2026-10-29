/**
 * 1.3 — the podcast page's episode read and the card play button. Pins: one
 * request per page on the episodes route (season and paging in the query),
 * each episode keeps its date, number and summary beside the playable Song,
 * unplayable entries drop, an empty page is an answer (the end), and the
 * card button plays the first page or says why it could not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const orchestratedRequest = vi.fn();
const getPodcastEpisodes = vi.fn();
const playQueue = vi.fn();
const toast = vi.fn();

vi.mock('@/services/api', async () => {
  const { episodeToSong } = await import('@/services/api/catalog');
  return {
    episodeToSong,
    orchestratedRequest: (req: unknown) => orchestratedRequest(req),
    getPodcastEpisodes: (...a: unknown[]) => getPodcastEpisodes(...a),
  };
});
vi.mock('@/store/playerStore', () => ({ usePlayerStore: { getState: () => ({ playQueue }) } }));
vi.mock('@/store/toastStore', () => ({ toast: (m: string) => toast(m) }));

import { getEpisodePage, playPodcast } from './api';

const raw = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Episode ${id}`,
  description: 'Kirthi &amp; Shaan talk jingles.',
  podcast: { id: '62', name: 'Talking Music' },
  episodeNumber: 2,
  releaseDate: '2017-10-11',
  duration: 1716,
  artists: [{ id: '1', name: 'Kirthi Shetty' }],
  image: [],
  downloadUrl: [{ quality: 'original', url: `https://a.sop.saavncdn.com/${id}.mp3` }],
  ...over,
});

/** Run the request's validator on a payload, as the client would. */
function answer(payload: unknown) {
  orchestratedRequest.mockImplementation(async (req: { validate: (j: unknown) => unknown }) => {
    const v = req.validate(payload);
    if (v === null) throw new Error('invalid');
    return v;
  });
}

beforeEach(() => {
  orchestratedRequest.mockReset();
  getPodcastEpisodes.mockReset();
  playQueue.mockReset();
  toast.mockReset();
});

describe('getEpisodePage', () => {
  it('asks for one page of one season and keeps the date, number and summary', async () => {
    answer({ success: true, data: [raw('a'), raw('b', { description: '', releaseDate: null, episodeNumber: null })] });
    const page = await getEpisodePage('62', { season: 1, page: 2, limit: 20 });
    expect(orchestratedRequest.mock.calls[0][0].paths).toEqual(['/podcasts/62/episodes?page=2&limit=20&season=1']);
    expect(page).toHaveLength(2);
    expect(page[0]).toMatchObject({
      description: 'Kirthi & Shaan talk jingles.',
      releaseDate: '2017-10-11',
      number: 2,
      song: { id: 'a', title: 'Episode a', album: { id: '62', name: 'Talking Music' }, audio: [{ quality: 'original' }] },
    });
    expect(page[1]).toMatchObject({ description: null, releaseDate: null, number: null });
  });

  it('leaves the season out when none is picked, drops unplayable entries and treats [] as the end', async () => {
    answer({ data: [raw('a'), raw('silent', { downloadUrl: [] })] });
    const page = await getEpisodePage('62', { page: 1 });
    expect(orchestratedRequest.mock.calls[0][0].paths).toEqual(['/podcasts/62/episodes?page=1&limit=20']);
    expect(page.map((e) => e.song.id)).toEqual(['a']);
    answer({ data: [] });
    await expect(getEpisodePage('62', { page: 9 })).resolves.toEqual([]);
  });

  it('rejects a payload that is not a list', async () => {
    answer({ data: { error: 'nope' } });
    await expect(getEpisodePage('62', { page: 1 })).rejects.toThrow();
  });
});

describe('playPodcast', () => {
  it('plays the first page of episodes', async () => {
    const songs = [{ id: 'a' }, { id: 'b' }];
    getPodcastEpisodes.mockResolvedValue(songs);
    await playPodcast('62', 'Talking Music');
    expect(getPodcastEpisodes).toHaveBeenCalledWith('62', { page: 1, limit: 20 });
    expect(playQueue).toHaveBeenCalledWith(songs, 0);
    expect(toast).toHaveBeenCalledWith('Playing Talking Music');
  });

  it('says so when there is nothing to play or the catalogue is down', async () => {
    getPodcastEpisodes.mockResolvedValue([]);
    await playPodcast('62', 'Talking Music');
    expect(toast).toHaveBeenLastCalledWith('No playable episodes found');
    getPodcastEpisodes.mockRejectedValue(new Error('down'));
    await playPodcast('62', 'Talking Music');
    expect(toast).toHaveBeenLastCalledWith('Couldn’t load this podcast right now');
    expect(playQueue).not.toHaveBeenCalled();
  });
});
