// @vitest-environment jsdom
/**
 * 1.3 — a podcast episode plays like a song. Pins, on payloads shaped like
 * the live API's: episodeToSong keeps the one `original` MP3; every quality
 * preference streams it (the engine sorts by bitrate and an unlabelled
 * file must not be dropped); the engine loads it without a fatal error;
 * downloads pick it; and the player's stale-URL refetch (getSong on the
 * episode id) gets the same file back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/downloads', async (orig) => ({ ...(await orig<typeof import('@/services/downloads')>()), getOfflineSources: () => [] }));

const MP3 = 'https://a.sop.saavncdn.com/131/TM-SA-S1-EP0.mp3';
const RAW_EPISODE = {
  id: 'sHc5GY6e',
  name: 'Trailer-Talking Music',
  description: 'Meet the superstars behind your favorite songs.',
  type: 'episode',
  podcast: { id: '62', name: 'Talking Music' },
  season: 1,
  episodeNumber: 1,
  releaseDate: '2017-10-11',
  duration: 39,
  language: 'hindi',
  playCount: 45678,
  explicitContent: false,
  artists: [{ id: '2673255', name: 'Kirthi Shetty', role: 'Host', image: [], type: 'artist' }],
  image: [{ quality: '500x500', url: 'https://c.sop.saavncdn.com/Talking-Music-Episode-500x500.jpg' }],
  downloadUrl: [{ quality: 'original', url: MP3, bitrate: null, extension: 'mp3', format: 'mp3' }],
};
/** What /songs/:id answers for the same episode (album empty, artists nested). */
const RAW_SONG_LOOKUP = {
  ...RAW_EPISODE,
  podcast: undefined,
  year: '2017',
  hasLyrics: false,
  album: { id: null, name: null, url: null },
  artists: { primary: [], featured: [], all: RAW_EPISODE.artists },
};

class FakeAudio extends EventTarget {
  static last: FakeAudio | null = null;
  src = '';
  currentSrc = '';
  volume = 1;
  muted = false;
  paused = true;
  currentTime = 0;
  duration = NaN;
  readyState = 0;
  networkState = 0;
  playbackRate = 1;
  preload = '';
  crossOrigin: string | null = null;
  error = null;
  constructor() {
    super();
    FakeAudio.last = this;
  }
  load(): void {
    this.currentSrc = this.src;
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  removeAttribute(): void {
    this.src = '';
  }
}
(globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;

const { episodeToSong } = await import('@/services/api/catalog');
const { normalizeSong } = await import('@/services/api/normalize');
const { audioEngine, orderedSources } = await import('@/services/audio/engine');
const { downloadUrls } = await import('@/services/downloads');
const { isEpisode, collectionPath } = await import('./paths');

let episode: Song;
beforeEach(() => {
  episode = episodeToSong(RAW_EPISODE) as Song;
});

describe('podcast episode playback', () => {
  it('becomes a Song with the one original MP3, the hosts and the show as its album', () => {
    expect(episode).toMatchObject({
      id: 'sHc5GY6e',
      title: 'Trailer-Talking Music',
      subtitle: 'Kirthi Shetty',
      album: { id: '62', name: 'Talking Music' },
      duration: 39,
      audio: [{ quality: 'original', url: MP3 }],
    });
    expect(isEpisode(episode)).toBe(true);
    expect(collectionPath(episode)).toBe('/podcast/talking-music-62');
  });

  it('streams the MP3 under every quality preference', () => {
    for (const pref of ['low', 'medium', 'high'] as const) expect(orderedSources(episode, pref)).toEqual([MP3]);
  });

  it('loads into the engine without a fatal error', () => {
    audioEngine.destroy();
    const cb = { onTime: vi.fn(), onPlayState: vi.fn(), onBuffering: vi.fn(), onEnded: vi.fn(), onFatalError: vi.fn(), onSource: vi.fn(), onBlocked: vi.fn() };
    audioEngine.init(cb);
    audioEngine.load(episode, 'medium', true);
    expect(FakeAudio.last?.src).toBe(MP3);
    expect(cb.onFatalError).not.toHaveBeenCalled();
    // No bitrate in the file name: the badge says unknown rather than guessing.
    expect(cb.onSource).toHaveBeenLastCalledWith(null);
    audioEngine.destroy();
  });

  it('downloads the same file', () => {
    expect(downloadUrls(episode)).toEqual([MP3]);
  });

  it('gets the same file back from the song lookup the player retries with', () => {
    const fresh = normalizeSong(RAW_SONG_LOOKUP) as Song;
    expect(fresh.id).toBe(episode.id);
    expect(orderedSources(fresh, 'high')).toEqual([MP3]);
    // The lookup has no show, so nothing links to an album page.
    expect(collectionPath(fresh)).toBeNull();
  });

  it('never mistakes a song for an episode', () => {
    const song = { ...episode, audio: [{ quality: '160kbps', url: 'a' }, { quality: '320kbps', url: 'b' }], album: { id: '9', name: 'Film' } };
    expect(isEpisode(song)).toBe(false);
    expect(collectionPath(song)).toBe('/album/film-9');
    expect(isEpisode({ audio: [] })).toBe(false);
  });
});
