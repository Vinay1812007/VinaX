import { describe, expect, it } from 'vitest';
import { CORRECTION_COOLDOWN_MS, decideCorrection, HostClock, hostIsAway, ReactionFeed, type LocalPlayer } from './sync';

const T0 = Date.parse('2026-10-05T10:00:00.000Z');

describe('HostClock (server-clock projection)', () => {
  it('projects the host playhead from (server now − updated_at) + half the round trip', () => {
    const c = new HostClock();
    // Host pushed 30.0 s at T0; the server answered 2.5 s later; the poll took 200 ms.
    c.ingest({ position: 30, playing: true, updated_at: new Date(T0).toISOString(), now: T0 + 2500, rttMs: 200, receivedAt: 1000 });
    expect(c.positionAt(1000)).toBeCloseTo(32.6, 5);
    // One second later on our own monotonic clock.
    expect(c.positionAt(2000)).toBeCloseTo(33.6, 5);
  });

  it('is immune to a guest clock that is minutes off — only server stamps are compared', () => {
    const c = new HostClock();
    c.ingest({ position: 10, playing: true, updated_at: new Date(T0).toISOString(), now: T0 + 1000, rttMs: 0, receivedAt: 5 });
    // receivedAt / positionAt use performance.now(), never Date.now(); a skewed wall clock cannot leak in.
    expect(c.positionAt(5)).toBeCloseTo(11, 5);
  });

  it('a paused host stays put', () => {
    const c = new HostClock();
    c.ingest({ position: 42, playing: false, updated_at: new Date(T0).toISOString(), now: T0 + 9000, rttMs: 300, receivedAt: 0 });
    expect(c.positionAt(0)).toBe(42);
    expect(c.positionAt(60_000)).toBe(42);
  });

  it('falls back to the old anchor against a pre-10.0 server (no `now`)', () => {
    const c = new HostClock();
    const stamp = new Date(T0).toISOString();
    c.ingest({ position: 5, playing: true, updated_at: stamp, receivedAt: 0 });
    // Same stamp again: the anchor must not move.
    c.ingest({ position: 5, playing: true, updated_at: stamp, receivedAt: 2000 });
    expect(c.positionAt(2000)).toBeCloseTo(7.35, 5);
  });
});

const playing = (over: Partial<LocalPlayer> = {}): LocalPlayer => ({
  songId: 'a',
  isPlaying: true,
  isBuffering: false,
  currentTime: 30,
  duration: 200,
  ...over,
});
const base = { hostSongId: 'a', hostPlaying: true, expected: 30, sinceLastCorrectionMs: 60_000, sinceTrackStartMs: 60_000 };

describe('decideCorrection', () => {
  it('loads the host song when ours differs', () => {
    expect(decideCorrection({ ...base, local: playing({ songId: 'b' }) }).kind).toBe('load');
  });
  it('does nothing inside the threshold', () => {
    expect(decideCorrection({ ...base, expected: 30.8, local: playing() }).kind).toBe('none');
  });
  it('seeks when drift passes a second, and reports the drift', () => {
    const c = decideCorrection({ ...base, expected: 32, local: playing() });
    expect(c).toEqual({ kind: 'seek', to: 32, drift: -2 });
  });
  it('never corrects while buffering or inside the cooldown (the old flapping)', () => {
    expect(decideCorrection({ ...base, expected: 40, local: playing({ isBuffering: true }) }).kind).toBe('none');
    expect(decideCorrection({ ...base, expected: 40, sinceLastCorrectionMs: CORRECTION_COOLDOWN_MS - 1, local: playing() }).kind).toBe('none');
  });
  it('lets a fresh track settle before judging its position', () => {
    expect(decideCorrection({ ...base, expected: 40, sinceTrackStartMs: 500, local: playing() }).kind).toBe('none');
  });
  it('matches play / pause before position', () => {
    expect(decideCorrection({ ...base, local: playing({ isPlaying: false }) }).kind).toBe('play');
    expect(decideCorrection({ ...base, hostPlaying: false, local: playing() }).kind).toBe('pause');
  });
  it('never seeks past the end of the song', () => {
    const c = decideCorrection({ ...base, expected: 260, local: playing({ currentTime: 100, duration: 200 }) });
    expect(c).toMatchObject({ kind: 'seek', to: 199.5 });
  });
});

describe('hostIsAway', () => {
  it('only after 90 s without a push, and never without a server clock', () => {
    const stamp = new Date(T0).toISOString();
    expect(hostIsAway({ updated_at: stamp, now: T0 + 30_000 })).toBe(false);
    expect(hostIsAway({ updated_at: stamp, now: T0 + 91_000 })).toBe(true);
    expect(hostIsAway({ updated_at: stamp })).toBe(false);
  });
});

describe('ReactionFeed', () => {
  const r = (ms: number, e = '🔥') => ({ e, at: new Date(T0 + ms).toISOString() });

  it('the first poll only primes: nothing from before you arrived floats', () => {
    const f = new ReactionFeed();
    expect(f.ingest([r(0), r(1)], T0)).toEqual([]);
    expect(f.ingest([r(0), r(1), r(2, '❤️')], T0)).toEqual(['❤️']);
  });

  it('each reaction floats once, however many polls repeat it', () => {
    const f = new ReactionFeed();
    f.ingest([], T0);
    expect(f.ingest([r(5)], T0)).toEqual(['🔥']);
    expect(f.ingest([r(5)], T0)).toEqual([]);
  });

  it('works whatever this device clock says (no client/server time comparison)', () => {
    const f = new ReactionFeed();
    f.ingest([], T0 - 3_600_000);
    expect(f.ingest([r(5)], T0 - 3_600_000)).toEqual(['🔥']);
  });

  it('skips the echo of your own tap once', () => {
    const f = new ReactionFeed();
    f.ingest([], T0);
    f.sent('🔥', T0);
    expect(f.ingest([r(5)], T0)).toEqual([]);
    expect(f.ingest([r(5), r(6)], T0)).toEqual(['🔥']);
  });
});
