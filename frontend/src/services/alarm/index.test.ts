// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakePlayer {
  volume: number;
  muted: boolean;
  setVolume(v: number): void;
  toggleMute(): void;
}

const h = vi.hoisted(() => ({
  engineVolume: vi.fn<(v: number) => void>(),
  storeWrites: [] as number[],
  player: null as unknown as FakePlayer,
}));

vi.mock('@/store/playerStore', () => ({ usePlayerStore: { getState: () => h.player } }));
vi.mock('@/store/alarmStore', () => ({ useAlarmStore: { getState: () => ({ enabled: false }), subscribe: () => undefined } }));
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: { getState: () => ({ favorites: [], collections: [] }) } }));
vi.mock('@/store/toastStore', () => ({ toast: () => undefined }));
vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));
vi.mock('@/services/audio/engine', () => ({ audioEngine: { setVolume: h.engineVolume } }));

const { fadeIn, localDayKey } = await import('./index');

function player(volume: number, muted = false): FakePlayer {
  const p: FakePlayer = {
    volume,
    muted,
    setVolume: (v) => {
      h.storeWrites.push(v);
      h.player = { ...h.player, volume: v };
    },
    toggleMute: () => {
      h.player = { ...h.player, muted: !h.player.muted };
    },
  };
  return p;
}

describe('localDayKey', () => {
  it('is the LOCAL calendar date, zero-padded', () => {
    expect(localDayKey(new Date(2026, 0, 5, 0, 10))).toBe('2026-01-05');
    expect(localDayKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('does not change within one local day, whatever the zone', () => {
    const keys = [0, 5, 6, 12, 18, 23].map((hour) => localDayKey(new Date(2026, 8, 17, hour, 30)));
    expect(new Set(keys).size).toBe(1);
  });

  describe('east of Greenwich', () => {
    const before = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata';
    const switched = new Date(2026, 8, 17, 12).getTimezoneOffset() === -330;
    process.env.TZ = before;

    beforeEach(() => {
      process.env.TZ = 'Asia/Kolkata';
    });
    afterEach(() => {
      process.env.TZ = before;
    });

    // 05:29 and 05:31 local straddle UTC midnight: the old UTC key changed
    // between them, so a 05:29 alarm fired twice.
    it.skipIf(!switched)('keeps one key across the UTC midnight at 05:30 local', () => {
      const a = new Date(2026, 8, 17, 5, 29);
      const b = new Date(2026, 8, 17, 5, 31);
      expect(a.toISOString().slice(0, 10)).not.toBe(b.toISOString().slice(0, 10));
      expect(localDayKey(a)).toBe('2026-09-17');
      expect(localDayKey(b)).toBe('2026-09-17');
    });
  });
});

describe('alarm fadeIn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.engineVolume.mockClear();
    h.storeWrites = [];
  });
  afterEach(() => vi.useRealTimers());

  it('ramps the engine only and never rewrites the stored volume', () => {
    h.player = player(0.6);
    fadeIn();
    expect(h.engineVolume).toHaveBeenLastCalledWith(0.05);
    vi.advanceTimersByTime(15_000);
    expect(h.engineVolume).toHaveBeenLastCalledWith(0.6 * (15 / 30));
    vi.advanceTimersByTime(15_000);
    expect(h.engineVolume).toHaveBeenLastCalledWith(0.6);
    expect(h.storeWrites).toEqual([]);
    expect(h.player.volume).toBe(0.6);
    const calls = h.engineVolume.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(h.engineVolume).toHaveBeenCalledTimes(calls); // the ramp is over
  });

  it('stands down the moment the listener changes the volume', () => {
    h.player = player(0.6);
    fadeIn();
    vi.advanceTimersByTime(5_000);
    h.player = { ...h.player, volume: 0.3 }; // the store applied this to the engine itself
    const calls = h.engineVolume.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(h.engineVolume).toHaveBeenCalledTimes(calls);
  });

  it('raises a zeroed or muted player once so the alarm is audible', () => {
    h.player = player(0, true);
    fadeIn();
    expect(h.storeWrites).toEqual([0.8]);
    expect(h.player.muted).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(h.engineVolume).toHaveBeenLastCalledWith(0.8);
    expect(h.storeWrites).toEqual([0.8]);
  });

  it('a second alarm ramp replaces the first instead of fighting it', () => {
    h.player = player(0.6);
    fadeIn();
    vi.advanceTimersByTime(10_000);
    fadeIn();
    h.engineVolume.mockClear();
    vi.advanceTimersByTime(1_000);
    expect(h.engineVolume).toHaveBeenCalledTimes(1);
    expect(h.engineVolume).toHaveBeenLastCalledWith(0.05);
  });
});
