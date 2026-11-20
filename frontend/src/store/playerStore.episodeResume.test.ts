// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

/**
 * Podcast resume: the player hands every saved place of an episode to the
 * podcast chunk (its own list, "played" at 95%), and its 80-place song map
 * never pushes an episode's place out.
 */
interface EngineHandlers {
  onTime(currentTime: number, duration: number): void;
  onEnded(): void;
  onFatalError(songId: string): void;
  onPlayState(playing: boolean): void;
}
const engine = vi.hoisted(() => ({ handlers: null as EngineHandlers | null }));
vi.mock('@/services/audio/engine', () => ({
  audioEngine: {
    init: vi.fn((h: EngineHandlers) => { engine.handlers = h; }),
    load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(),
    setVolume: vi.fn(), setMuted: vi.fn(), setRate: vi.fn(), fadeIn: vi.fn(), fadeOut: vi.fn(), fadeOutAndPause: vi.fn(),
    reloadWithSources: vi.fn(() => true),
    currentSongId: null,
  },
  orderedSources: () => ['https://cdn.test/a.mp3'],
}));
vi.mock('@/services/media-session', () => ({ setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn() }));
vi.mock('@/services/personalization/updater', () => ({ recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/services/cast', () => ({ useCastStore: { getState: () => ({ connected: false }) }, castInterceptPlayPause: () => false, castInterceptSeek: () => false, castInterceptVolume: () => false, castMime: vi.fn() }));
vi.mock('@/services/analytics/telemetry', () => ({ trackSkip: vi.fn(), trackComplete: vi.fn() }));
vi.mock('@/services/recommendation/transitions', () => ({ recordTransition: vi.fn(), transitionScore: () => 0 }));
const recommendMock = vi.fn(async (): Promise<Song[]> => []);
vi.mock('@/services/autoplay', () => ({
  findAutoplaySongs: () => recommendMock(),
  pickAutoplay: (songs: unknown[]) => songs,
}));
const sessionEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/personalization/sessionIntent', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/personalization/sessionIntent')>()), noteSessionEvent: sessionEvent }));
const getSongMock = vi.fn<(id: string) => Promise<Song>>();
vi.mock('@/services/api', () => ({ getSong: (id: string) => getSongMock(id) }));

import { usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';
import { useHistoryStore } from './historyStore';
import { EPISODE_PROGRESS_KEY } from '@/features/podcasts/episode';

const RESUME = 'vinax.resume.v1';
const song = (id: string): Song => ({ kind: 'song', id, title: id, subtitle: 'Artist', artists: [{ id: `a-${id}`, name: `Artist ${id}` }], album: null, images: [], audio: [{ quality: '320kbps', url: `https://x/${id}.mp4` }], duration: 1800, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null });
const episode = (id: string): Song => ({ ...song(id), album: { id: '62', name: 'Talking Music' }, audio: [{ quality: 'original', url: `https://x/${id}.mp3` }] });
const tick = (t: number, d = 1800) => engine.handlers?.onTime(t, d);
const settle = async () => { await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0); };
const read = (key: string) => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  useHistoryStore.setState({ entries: [] });
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, autoplay: false, mutedLanguages: [] });
  usePlayerStore.getState().clearQueue();
  usePlayerStore.setState({ queue: [], runs: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, sleepAt: null, sleepSongsLeft: 0, sleepAfterTrack: false, volume: 0.8, muted: false });
  usePlayerStore.getState().initEngine();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('podcast episode places', () => {
  it('an episode\'s place goes to its own list as well as the resume map', async () => {
    usePlayerStore.getState().playSong(episode('ep'));
    tick(600);
    await settle();
    expect(read(RESUME).ep).toBe(600);
    expect(read(EPISODE_PROGRESS_KEY).ep).toMatchObject({ sec: 600, dur: 1800, played: false });
  });

  it('a song\'s place does not', async () => {
    usePlayerStore.getState().playSong(song('s'));
    tick(600);
    await settle();
    expect(read(RESUME).s).toBe(600);
    expect(localStorage.getItem(EPISODE_PROGRESS_KEY)).toBeNull();
  });

  it('marks the episode played past 95% and forgets its place', async () => {
    usePlayerStore.getState().playSong(episode('ep'));
    tick(1715);
    await settle();
    expect(read(EPISODE_PROGRESS_KEY).ep).toMatchObject({ played: true });
    expect(read(RESUME).ep).toBeUndefined();
  });

  it('music listening never pushes an episode\'s place out of the full resume map', async () => {
    usePlayerStore.getState().playSong(episode('ep'));
    tick(600);
    await settle();
    // The episode is the oldest place; 80 songs after it fill the map.
    const full: Record<string, number> = { ep: 600 };
    for (let i = 0; i < 80; i += 1) full[`s${i}`] = 100;
    localStorage.setItem(RESUME, JSON.stringify(full));
    usePlayerStore.getState().playSong(song('new'));
    tick(300);
    const map = read(RESUME);
    expect(map.ep).toBe(600);
    expect(map.s0).toBeUndefined();
    expect(map.new).toBe(300);
  });

  it('an episode left in its first seconds tells this sitting nothing; a song does', () => {
    usePlayerStore.getState().playQueue([episode('ep'), song('a'), song('b')], 0);
    usePlayerStore.getState().next(true);
    expect(sessionEvent).not.toHaveBeenCalled();
    usePlayerStore.getState().next(true);
    expect(sessionEvent).toHaveBeenCalledWith('skip', expect.objectContaining({ id: 'a' }));
  });
});
