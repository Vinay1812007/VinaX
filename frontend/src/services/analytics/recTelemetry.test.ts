// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

/**
 * 7.2.0 — recommendation outcomes, opt-in only: one `rec_served` per automatic
 * continuation with its FINAL picker, one `rec_outcome` per automatic play
 * judged by the playback session's own thresholds, nothing without consent,
 * and no identifier beyond what usage events already carry. The last block
 * drives the real player store, so the events are the ones it emits.
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
vi.mock('@/services/personalization/updater', () => ({ recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/services/cast', () => ({ useCastStore: { getState: () => ({ connected: false }) }, castInterceptPlayPause: () => false, castInterceptSeek: () => false, castInterceptVolume: () => false, castMime: vi.fn() }));
vi.mock('@/utils/streak', () => ({ bumpStreak: vi.fn() }));
vi.mock('@/services/recommendation/adaptive', () => ({ noteSkipAndMaybeReplan: vi.fn(), noteCompleted: vi.fn() }));
vi.mock('@/services/recommendation/transitions', () => ({ recordTransition: vi.fn(), transitionScore: () => 0 }));
const planner = vi.hoisted(() => ({ next: null as null | (() => Promise<unknown>) }));
vi.mock('@/services/recommendation/engine', () => ({
  NEXT_URGENT_DEADLINE_MS: 3500,
  planNextSongs: async () => {
    const next = planner.next;
    planner.next = null; // one plan per test; later requests get nothing
    return next ? next() : { songs: [], picker: 'local', fallback: null, latencyMs: 0, alg: 'test', relaxed: [], discoveryIds: new Set<string>(), language: null, commit: () => undefined, topUp: () => [], refinement: null };
  },
}));
vi.mock('@/services/api', () => ({ getSong: vi.fn() }));

import { COMPLETE_RATIO, SKIP_RATIO, UNKNOWN_DURATION_SEC, COUNTED_PLAY_SEC, emitPlaybackEvent, newRun, type AutoEntryMeta, type PlaybackEndReason, type PlaybackEvent } from '@/services/playback/session';
import { KEYS } from '@/constants/storage-keys';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { resetSessionIntent } from '@/services/personalization/sessionIntent';
import { classifyOutcome, initRecTelemetry, REC_BUCKET, REC_OUTBOX_CAP, REC_REFILL_MS, REFINE_WAIT_MS } from './recTelemetry';
import { decideRecVariant, EXP_REC_CONFIG, EXP_REC_NEXT_SONGS, resetRecExperiments } from '@/features/experiments/recExperiment';
import { applyWeightOverrides, resetWeightOverrides } from '@/services/recommendation/weights';

const song = (id: string): Song => ({ kind: 'song', id, title: `Title ${id}`, subtitle: `Artist ${id}`, artists: [{ id: `a-${id}`, name: `Artist ${id}` }], album: null, images: [], audio: [], duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null });
const ALG = '7.2.0/1.2.0';

let experiments: unknown[] = [];
const fetchMock = vi.fn(async (url: unknown, _init?: unknown) => {
  if (String(url).endsWith('/api/experiments')) return { ok: true, status: 200, json: async () => ({ experiments }) };
  return { ok: true, status: 204, json: async () => ({}) };
});
const bodies = (): Array<Record<string, unknown>> =>
  fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/api/events')).map((c) => JSON.parse(String((c[1] as { body: string }).body)) as Record<string, unknown>);
const recBodies = () => bodies().filter((b) => String(b.type).startsWith('rec_'));
const ofType = (type: string) => bodies().filter((b) => b.type === type).map((b) => b.meta as Record<string, unknown>);
const consent = (on: boolean) => localStorage.setItem(KEYS.analyticsConsent, JSON.stringify(on));

const served = (batch: number, over: Partial<Extract<PlaybackEvent, { kind: 'served' }>> = {}): PlaybackEvent => ({ kind: 'served', batch, alg: ALG, picker: 'local', fallback: null, latencyMs: 412.6, n: 5, discovery: 1, languageViolations: 0, distinctArtists: 4, relaxed: [], refinementPending: false, ...over });
const refined = (batch: number, applied: boolean, fallback: string | null, n = applied ? 5 : 0): PlaybackEvent => ({ kind: 'refined', batch, applied, fallback, latencyMs: 9000, n });
const auto = (batch: number, pos: number, picker: AutoEntryMeta['picker'] = 'local'): AutoEntryMeta => ({ alg: ALG, picker, pos, batch });
const ended = (id: string, heardSec: number, reason: PlaybackEndReason, a: AutoEntryMeta | null, durationSec = 200, run = newRun()): PlaybackEvent => ({ kind: 'end', instanceId: `pb-${id}`, song: song(id), from: null, heardSec, durationSec, reason, run, auto: a });
const settle = async () => { await vi.advanceTimersByTimeAsync(0); };
const tick = (t: number, d = 200) => engine.handlers?.onTime(t, d);
const listen = (from: number, to: number, d = 200) => { for (let t = from; t <= to + 1e-9; t += 0.25) tick(Math.round(t * 100) / 100, d); };

let stop: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  experiments = [];
  planner.next = null;
  resetRecExperiments();
  resetSessionIntent();
  useLibraryStore.getState().clearFavorites();
  useHistoryStore.setState({ entries: [] });
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, djTakeover: false, autoplay: true, mutedLanguages: [] });
  usePlayerStore.getState().clearQueue();
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, tuneIntent: null, sleepAt: null, sleepSongsLeft: 0, sleepAfterTrack: false, volume: 0.8, muted: false });
  usePlayerStore.getState().initEngine();
});
afterEach(() => {
  resetWeightOverrides();
  stop?.();
  stop = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('consent', () => {
  it('sends nothing — and asks for no experiment config — without consent', async () => {
    consent(false);
    stop = initRecTelemetry();
    emitPlaybackEvent(served(1));
    emitPlaybackEvent(ended('x', 200, 'ended', auto(1, 0)));
    await vi.advanceTimersByTimeAsync(REFINE_WAIT_MS + 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opting out mid-session stops the next event', async () => {
    consent(true);
    stop = initRecTelemetry();
    emitPlaybackEvent(served(1));
    await settle();
    expect(ofType('rec_served')).toHaveLength(1);
    consent(false);
    emitPlaybackEvent(served(2));
    emitPlaybackEvent(ended('x', 200, 'ended', auto(2, 0)));
    await settle();
    expect(recBodies()).toHaveLength(1);
  });
});

describe('rec_served — once per continuation, with the final picker', () => {
  beforeEach(() => consent(true));

  it('is sent at once when no refinement is pending', async () => {
    stop = initRecTelemetry();
    emitPlaybackEvent(served(1, { fallback: 'deadline', relaxed: ['language-lock'] }));
    await settle();
    expect(ofType('rec_served')).toEqual([{ alg: ALG, picker: 'local', fallback: 'deadline', latencyMs: 413, n: 5, discovery: 1, languageViolations: 0, distinctArtists: 4, relaxed: ['language-lock'], exp: {} }]);
  });

  it('waits for the refinement: applied → one event with picker ai', async () => {
    stop = initRecTelemetry();
    emitPlaybackEvent(served(1, { refinementPending: true }));
    await settle();
    expect(ofType('rec_served')).toHaveLength(0);
    emitPlaybackEvent(refined(1, true, null, 4));
    emitPlaybackEvent(refined(1, true, null, 4)); // a duplicate never produces a second event
    await vi.advanceTimersByTimeAsync(REFINE_WAIT_MS + 1);
    expect(ofType('rec_served')).toEqual([{ alg: ALG, picker: 'ai', fallback: null, latencyMs: 413, n: 4, discovery: null, languageViolations: null, distinctArtists: null, relaxed: null, exp: {} }]);
  });

  it('waits for the refinement: rejected → one event with picker local and the reason', async () => {
    stop = initRecTelemetry();
    emitPlaybackEvent(served(1, { refinementPending: true }));
    emitPlaybackEvent(refined(1, false, 'ai_rejected'));
    await settle();
    const [meta] = ofType('rec_served');
    expect(meta.picker).toBe('local');
    expect(meta.fallback).toBe('ai_rejected');
    expect(meta.discovery).toBe(1);
  });

  it('a refinement that never settles is reported once, after the bounded wait, as an AI timeout', async () => {
    stop = initRecTelemetry();
    emitPlaybackEvent(served(1, { refinementPending: true }));
    await vi.advanceTimersByTimeAsync(REFINE_WAIT_MS - 1);
    expect(ofType('rec_served')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(ofType('rec_served').map((m) => [m.picker, m.fallback])).toEqual([['local', 'ai_timeout']]);
    emitPlaybackEvent(refined(1, true, null)); // too late: nothing more
    await settle();
    expect(ofType('rec_served')).toHaveLength(1);
  });

  it('one event per batch across interleaved batches', async () => {
    stop = initRecTelemetry();
    emitPlaybackEvent(served(1, { refinementPending: true }));
    emitPlaybackEvent(served(2, { picker: 'reserve', fallback: 'deadline' }));
    emitPlaybackEvent(served(3, { refinementPending: true }));
    emitPlaybackEvent(refined(3, false, 'ai_unavailable'));
    emitPlaybackEvent(refined(1, true, null));
    await settle();
    expect(ofType('rec_served').map((m) => [m.picker, m.fallback])).toEqual([['reserve', 'deadline'], ['local', 'ai_unavailable'], ['ai', null]]);
  });
});

describe('rec_outcome — the session thresholds, never the playhead', () => {
  it('classifies by heard seconds with the session constants', () => {
    const d = 200;
    expect(classifyOutcome(COMPLETE_RATIO * d, d, 'ended')).toBe('complete');
    expect(classifyOutcome(COMPLETE_RATIO * d - 1, d, 'ended')).toBe('partial'); // reached the end by seeking: not a completion
    expect(classifyOutcome(COMPLETE_RATIO * d, d, 'repeat')).toBe('complete');
    expect(classifyOutcome(COUNTED_PLAY_SEC - 0.5, d, 'manual-skip')).toBe('early_skip');
    expect(classifyOutcome(COUNTED_PLAY_SEC + 1, d, 'manual-skip')).toBe('skip');
    expect(classifyOutcome(SKIP_RATIO * d - 1, d, 'manual-skip')).toBe('skip');
    expect(classifyOutcome(SKIP_RATIO * d + 1, d, 'manual-skip')).toBe('partial');
    expect(classifyOutcome(10, d, 'replaced')).toBe('partial'); // tapped another song: not a skip verdict
    expect(classifyOutcome(0, d, 'failed')).toBeNull();
    // Unknown length: 30 s is the line.
    expect(classifyOutcome(UNKNOWN_DURATION_SEC, 0, 'ended')).toBe('complete');
    expect(classifyOutcome(UNKNOWN_DURATION_SEC - 1, 0, 'ended')).toBe('partial');
    expect(classifyOutcome(UNKNOWN_DURATION_SEC - 1, 0, 'manual-skip')).toBe('skip');
    expect(classifyOutcome(COUNTED_PLAY_SEC - 1, 0, 'manual-skip')).toBe('early_skip');
  });

  it('is sent for automatic entries only, once per run, with liked from the favourites of that moment', async () => {
    consent(true);
    stop = initRecTelemetry();
    useLibraryStore.getState().toggleFavorite(song('b'));
    const run = newRun();
    emitPlaybackEvent(ended('mine', 200, 'ended', null)); // the listener's own song
    emitPlaybackEvent(ended('a', 12, 'manual-skip', auto(1, 0)));
    emitPlaybackEvent(ended('b', 180, 'repeat', auto(1, 1, 'ai'), 200, run));
    emitPlaybackEvent(ended('b', 180, 'repeat', auto(1, 1, 'ai'), 200, run)); // the same run looping
    emitPlaybackEvent(ended('c', 0, 'failed', auto(1, 2)));
    await settle();
    expect(ofType('rec_outcome')).toEqual([
      { alg: ALG, picker: 'local', pos: 0, heardSec: 12, durationSec: 200, outcome: 'skip', liked: false, exp: {} },
      { alg: ALG, picker: 'ai', pos: 1, heardSec: 180, durationSec: 200, outcome: 'complete', liked: true, exp: {} },
    ]);
  });
});

describe('what leaves the device', () => {
  it('no song, no song id, no batch number, no new identifier', async () => {
    consent(true);
    stop = initRecTelemetry();
    emitPlaybackEvent(served(7));
    emitPlaybackEvent(ended('secret-song-id', 190, 'ended', auto(7, 3)));
    await settle();
    const events = recBodies();
    expect(events.map((b) => b.type)).toEqual(['rec_served', 'rec_outcome']);
    for (const body of events) {
      // Exactly the fields every usage event already carries, plus meta.
      expect(Object.keys(body).sort()).toEqual(['appVersion', 'deviceId', 'meta', 'platform', 'type']);
      expect(JSON.stringify(body)).not.toContain('secret-song-id');
      expect(JSON.stringify(body.meta)).not.toMatch(/"batch"|"song"|"id"/);
    }
    expect(Object.keys(ofType('rec_served')[0]).sort()).toEqual(['alg', 'discovery', 'distinctArtists', 'exp', 'fallback', 'languageViolations', 'latencyMs', 'n', 'picker', 'relaxed']);
    expect(Object.keys(ofType('rec_outcome')[0]).sort()).toEqual(['alg', 'durationSec', 'exp', 'heardSec', 'liked', 'outcome', 'picker', 'pos']);
  });
});

describe('experiments', () => {
  it('exp carries an experiment only when a decision shaped the served continuation, and follows its songs', async () => {
    consent(true);
    experiments = [{ key: EXP_REC_NEXT_SONGS, variants: [{ name: 'treatment', pct: 100 }] }];
    stop = initRecTelemetry();
    await settle(); // the config read
    emitPlaybackEvent(served(1)); // assigned, but nothing read the variant
    decideRecVariant(EXP_REC_NEXT_SONGS);
    emitPlaybackEvent(served(2));
    emitPlaybackEvent(ended('a', 190, 'ended', auto(2, 0)));
    emitPlaybackEvent(ended('b', 190, 'ended', auto(1, 4)));
    await settle();
    expect(ofType('rec_served').map((m) => m.exp)).toEqual([{}, { [EXP_REC_NEXT_SONGS]: 'treatment' }]);
    expect(ofType('rec_outcome').map((m) => m.exp)).toEqual([{ [EXP_REC_NEXT_SONGS]: 'treatment' }, {}]);
  });

  it('an applied owner tuning rollout rides as rec-config, as of the moment the continuation was served', async () => {
    consent(true);
    stop = initRecTelemetry();
    applyWeightOverrides({ mood: 0.2 }, { version: 7, variant: 'warmer' });
    emitPlaybackEvent(served(1, { alg: '7.2.0/1.2.0+rc7' }));
    applyWeightOverrides({ mood: 0.2 }, { version: 8, variant: null });
    emitPlaybackEvent(served(2, { alg: '7.2.0/1.2.0+rc8' }));
    resetWeightOverrides();
    emitPlaybackEvent(served(3));
    emitPlaybackEvent(ended('a', 190, 'ended', auto(1, 0)));
    await settle();
    expect(ofType('rec_served').map((m) => [m.alg, m.exp])).toEqual([
      ['7.2.0/1.2.0+rc7', { [EXP_REC_CONFIG]: 'warmer' }],
      ['7.2.0/1.2.0+rc8', { [EXP_REC_CONFIG]: 'all' }],
      [ALG, {}],
    ]);
    expect(ofType('rec_outcome')[0].exp).toEqual({ [EXP_REC_CONFIG]: 'warmer' });
  });
});

describe('volume', () => {
  it('a burst is paced by the bucket, and an overflowing outbox drops instead of flooding', async () => {
    consent(true);
    stop = initRecTelemetry();
    const burst = REC_BUCKET + REC_OUTBOX_CAP + 10;
    for (let i = 0; i < burst; i += 1) emitPlaybackEvent(ended(`s${i}`, 3, 'manual-skip', auto(1, i % 5)));
    await settle();
    expect(ofType('rec_outcome')).toHaveLength(REC_BUCKET);
    await vi.advanceTimersByTimeAsync(REC_REFILL_MS);
    expect(ofType('rec_outcome')).toHaveLength(REC_BUCKET + 1);
    await vi.advanceTimersByTimeAsync(REC_REFILL_MS * (REC_OUTBOX_CAP + 20));
    expect(ofType('rec_outcome')).toHaveLength(REC_BUCKET + REC_OUTBOX_CAP);
  });
});

describe('with the real player', () => {
  it('a continuation refined by the AI is reported once, as ai; its songs report outcomes by heard time', async () => {
    consent(true);
    stop = initRecTelemetry();
    const picks = ['n1', 'n2', 'n3', 'n4', 'n5'].map(song);
    let answer: (v: unknown) => void = () => undefined;
    const refinement = new Promise((resolve) => { answer = resolve; });
    const plan = { songs: picks, picker: 'local', fallback: null, latencyMs: 640, alg: ALG, relaxed: [], discoveryIds: new Set(['n5']), language: 'telugu', commit: () => undefined, topUp: () => [], refinement };
    planner.next = async () => plan;
    usePlayerStore.getState().playSong(song('seed'));
    await settle();
    await settle();
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['seed', 'n1', 'n2', 'n3', 'n4', 'n5']);
    expect(ofType('rec_served')).toHaveLength(0); // the final picker is not known yet
    answer({ ...plan, songs: [picks[2], picks[0], picks[1], picks[3], picks[4]], picker: 'ai', latencyMs: 7000, refinement: null });
    await settle();
    await settle();
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['seed', 'n3', 'n1', 'n2', 'n4', 'n5']);
    expect(ofType('rec_served')).toEqual([{ alg: ALG, picker: 'ai', fallback: null, latencyMs: 640, n: 5, discovery: null, languageViolations: null, distinctArtists: 5, relaxed: null, exp: {} }]);

    // The seed is the listener's own: its end reports nothing. The first automatic song is flipped past at 2 s.
    listen(0.25, 20);
    usePlayerStore.getState().next(true);
    listen(0.25, 2);
    usePlayerStore.getState().next(true);
    // The second is heard to 150 of 200 s and ends on its own.
    listen(0.25, 150);
    engine.handlers?.onEnded();
    await settle();
    expect(ofType('rec_outcome').map((m) => [m.picker, m.pos, m.outcome])).toEqual([['ai', 0, 'early_skip'], ['ai', 1, 'complete']]);
  });
});
