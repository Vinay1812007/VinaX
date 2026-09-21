// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

/**
 * 7.2.0 — usage telemetry counts a play by the playback-session contract:
 * a `play` is sent when the run's PLAY is counted (enough of it heard), once
 * per run, and never without consent. Pause and heartbeat are unchanged.
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
vi.mock('@/utils/streak', () => ({ bumpStreak: vi.fn() }));
vi.mock('@/services/recommendation/adaptive', () => ({ noteSkipAndMaybeReplan: vi.fn(), noteCompleted: vi.fn() }));
vi.mock('@/services/recommendation/transitions', () => ({ recordTransition: vi.fn(), transitionScore: () => 0 }));
vi.mock('@/services/recommendation/engine', () => ({
  NEXT_URGENT_DEADLINE_MS: 3500,
  planNextSongs: async () => ({ songs: [], picker: 'local', fallback: null, latencyMs: 0, alg: 'test', relaxed: [], discoveryIds: new Set<string>(), language: null, commit: () => undefined, topUp: () => [], refinement: null }),
}));
vi.mock('@/services/api', () => ({ getSong: vi.fn() }));
vi.mock('web-vitals', () => ({ onLCP: vi.fn(), onINP: vi.fn(), onCLS: vi.fn() }));

import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import { resetSessionIntent } from '@/services/personalization/sessionIntent';
import { KEYS } from '@/constants/storage-keys';
import { disposeTelemetry, initTelemetry, META_MAX_BYTES, trackStructured } from './telemetry';

const song = (id: string): Song => ({ kind: 'song', id, title: id, subtitle: 'Artist', artists: [{ id: `a-${id}`, name: `Artist ${id}` }], album: null, images: [], audio: [], duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null });
const tick = (t: number, d = 200) => engine.handlers?.onTime(t, d);
/** Realistic ticks: a quarter-second apart, like the element's timeupdate. */
const listen = (from: number, to: number, d = 200) => { for (let t = from; t <= to + 1e-9; t += 0.25) tick(Math.round(t * 100) / 100, d); };

const fetchMock = vi.fn(async (..._args: unknown[]) => ({ status: 204, json: async () => ({}) }));
const posted = (): Array<Record<string, unknown>> => fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as { body: string }).body)) as Record<string, unknown>);
const plays = (): string[] => posted().filter((b) => b.type === 'play').map((b) => (b.song as { id: string }).id);
const consent = (on: boolean) => localStorage.setItem(KEYS.analyticsConsent, JSON.stringify(on));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  resetSessionIntent();
  useHistoryStore.setState({ entries: [] });
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, djTakeover: false, autoplay: false, mutedLanguages: [] });
  usePlayerStore.getState().clearQueue();
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, tuneIntent: null, sleepAt: null, sleepSongsLeft: 0, sleepAfterTrack: false, volume: 0.8, muted: false });
  usePlayerStore.getState().initEngine();
});
afterEach(() => {
  disposeTelemetry();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a play is sent when the session counts it', () => {
  it('a song skipped after 2 seconds sends no play; a song heard for 6 seconds sends exactly one', () => {
    consent(true);
    initTelemetry();
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    engine.handlers?.onPlayState(true);
    // The old rule sent a play here, the moment a new song id was playing.
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    listen(0.25, 2);
    usePlayerStore.getState().next(true); // flipped past at 2 s
    expect(plays()).toEqual([]);
    listen(0.25, 6);
    expect(plays()).toEqual(['b']);
    listen(6.25, 40); // keeps playing: still one play for this run
    expect(plays()).toEqual(['b']);
  });

  it('a repeat-one loop inside the same run sends nothing new', () => {
    consent(true);
    initTelemetry();
    usePlayerStore.getState().playSong(song('a'));
    usePlayerStore.setState({ repeat: 'one' });
    listen(0.25, 200);
    engine.handlers?.onEnded();
    listen(0.25, 30);
    expect(plays()).toEqual(['a']);
  });

  it('sends nothing at all without consent, however long the song plays', () => {
    consent(false);
    initTelemetry();
    usePlayerStore.getState().playSong(song('a'));
    listen(0.25, 60);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('structured events', () => {
  it('carry meta and no song', async () => {
    consent(true);
    await trackStructured('rec_served', { alg: '7.2.0/1.2.0', n: 5, relaxed: [], exp: {} });
    const [body] = posted();
    expect(body.type).toBe('rec_served');
    expect(body.meta).toEqual({ alg: '7.2.0/1.2.0', n: 5, relaxed: [], exp: {} });
    expect(body).not.toHaveProperty('song');
    expect(Object.keys(body).sort()).toEqual(['appVersion', 'deviceId', 'meta', 'platform', 'type'].sort());
  });

  it('an oversized meta is dropped, not truncated', async () => {
    consent(true);
    await trackStructured('rec_served', { blob: 'x'.repeat(META_MAX_BYTES) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects consent', async () => {
    consent(false);
    await trackStructured('rec_served', { n: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
