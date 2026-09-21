// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

/**
 * 7.1.1 — one current-state admission gate at every automatic queue mutation.
 * Review probe 2 (2026-09-19): `replaceAutoTail` only de-duplicated ids, so the
 * adaptive re-plan could bring an explicit favourite into a Kid-mode queue, a
 * hidden artist back, or a muted language in.
 */
interface EngineHandlers { onTime(currentTime: number, duration: number): void; onEnded(): void }
const engine = vi.hoisted(() => ({ handlers: null as EngineHandlers | null }));
vi.mock('@/services/audio/engine', () => ({
  audioEngine: {
    init: vi.fn((h: EngineHandlers) => { engine.handlers = h; }),
    load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(),
    setVolume: vi.fn(), setMuted: vi.fn(), setRate: vi.fn(), fadeIn: vi.fn(), fadeOut: vi.fn(), fadeOutAndPause: vi.fn(),
    currentSongId: null,
  },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({ setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn() }));
vi.mock('@/services/personalization/updater', () => ({ recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/services/cast', () => ({ useCastStore: { getState: () => ({ connected: false }) }, castInterceptPlayPause: () => false, castInterceptSeek: () => false, castInterceptVolume: () => false, castMime: vi.fn() }));
vi.mock('@/utils/streak', () => ({ bumpStreak: vi.fn() }));
vi.mock('@/services/analytics/telemetry', () => ({ trackSkip: vi.fn(), trackComplete: vi.fn() }));
const recommendMock = vi.fn(async (): Promise<Song[]> => []);
vi.mock('@/services/recommendation/engine', () => ({
  NEXT_URGENT_DEADLINE_MS: 3500,
  planNextSongs: async () => ({ songs: await recommendMock(), picker: 'local', fallback: null, latencyMs: 0, alg: 'test', relaxed: [], discoveryIds: new Set<string>(), language: null, commit: () => undefined, topUp: () => [], refinement: null }),
}));

import { usePlayerStore } from './playerStore';
import { useLibraryStore } from './libraryStore';
import { useHistoryStore } from './historyStore';
import { useSettingsStore } from './settingsStore';
import { resetAdaptive } from '@/services/recommendation/adaptive';
import { resetSessionIntent } from '@/services/personalization/sessionIntent';

const song = (id: string, artist = `Artist ${id}`, extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title: `Song ${id}`, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: null,
  images: [], audio: [], duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null, ...extra,
});
const ids = () => usePlayerStore.getState().queue.map((s) => s.id);
const flush = async () => { for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(0); };
const listen = (from: number, to: number) => { for (let t = from; t <= to + 1e-9; t += 0.25) engine.handlers?.onTime(Math.round(t * 100) / 100, 200); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  resetAdaptive();
  resetSessionIntent();
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, mutedLanguages: [], djTakeover: false, autoplay: true });
  useLibraryStore.setState({ favorites: [], collections: [], saved: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] });
  useHistoryStore.setState({ entries: [] });
  usePlayerStore.getState().clearQueue();
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, tuneIntent: null });
  usePlayerStore.getState().initEngine();
  recommendMock.mockReset();
  recommendMock.mockResolvedValue([]);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('replaceAutoTail admits only what may play right now', () => {
  it('refuses an explicit song while Kid mode is on', () => {
    useSettingsStore.setState({ kidMode: true });
    usePlayerStore.getState().playQueue([song('cur')], 0);
    usePlayerStore.getState().replaceAutoTail([song('x', 'X', { explicit: true }), song('ok')]);
    expect(ids()).toEqual(['cur', 'ok']);
  });

  it('refuses hidden songs, hidden artists, muted languages, junk, invalid entries and another cut of the playing song', () => {
    useLibraryStore.setState({ hiddenSongIds: ['h1'] });
    useLibraryStore.getState().toggleHiddenArtist('Bad Artist');
    useSettingsStore.setState({ mutedLanguages: ['hindi'] });
    const cur = song('cur', 'Sid');
    usePlayerStore.getState().playQueue([cur], 0);
    usePlayerStore.getState().replaceAutoTail([
      song('h1'),
      song('b1', 'Bad Artist'),
      song('hi1', 'H', { language: 'hindi' }),
      { ...cur, id: 'cur-cover', title: 'Song cur (Cover)' },
      song('junk', 'J', { title: 'Song junk (Dialogue)' }),
      { ...song('broken'), artists: undefined as unknown as Song['artists'] },
      song('ok'),
    ]);
    expect(ids()).toEqual(['cur', 'ok']);
  });

  it('the real two-skip adaptive path cannot bring an explicit favourite into a Kid-mode queue', async () => {
    useSettingsStore.setState({ kidMode: true });
    useLibraryStore.setState({ favorites: [song('fav-x', 'Loved X', { explicit: true, energy: 0.6 }), song('fav-ok', 'Loved OK', { energy: 0.6 })] });
    usePlayerStore.getState().playQueue([song('cur', 'Seed', { energy: 0.5 })], 0);
    usePlayerStore.getState().replaceAutoTail([song('t1', 'X', { energy: 0.2 }), song('t2', 'Y', { energy: 0.9 }), song('t3', 'Z', { energy: 0.3 }), song('t4', 'W', { energy: 0.5 }), song('t5', 'V', { energy: 0.4 }), song('t6', 'U', { energy: 0.6 })]);
    // Drive the player itself: hear a few seconds of each automatic song, then skip it.
    usePlayerStore.getState().next(false); // cur → t1
    listen(0, 8);
    usePlayerStore.getState().next(true); // skip t1
    await flush();
    listen(0, 8);
    usePlayerStore.getState().next(true); // skip t2 → the adaptive re-plan runs
    await flush();
    // The re-plan ran (a clean favourite came in) but the explicit one stayed out.
    expect(ids()).toContain('fav-ok');
    expect(ids()).not.toContain('fav-x');
  });
});
