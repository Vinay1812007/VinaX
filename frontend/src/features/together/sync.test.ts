import { describe, expect, it } from 'vitest';
import { CLOCK_SNAP_S, CORRECTION_COOLDOWN_MS, decideCorrection, Flight, HostClock, hostIsAway, NUDGE_MAX, NUDGE_START_S, NUDGE_STOP_S, RateNudge, ReactionFeed, SEEK_THRESHOLD_S, SeekLead, ServerClock, type LocalPlayer } from './sync';

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

  it('takes the server’s own time out of the round trip: it is not network flight', () => {
    const stamp = new Date(T0).toISOString();
    // The poll arrived 2.5 s after the push, the server spent 300 ms on the
    // database, and the whole round trip was 400 ms: 50 ms of flight each way.
    const c = new HostClock();
    c.ingest({ position: 30, playing: true, updated_at: stamp, now: T0 + 2500, took: 300, rttMs: 400, receivedAt: 1000 });
    // 30 + 2.5 (before the poll) + 0.3 (database) + 0.05 (flight back).
    expect(c.positionAt(1000)).toBeCloseTo(32.85, 5);
    // The old sum (half the round trip) put the host 150 ms behind that.
    const old = new HostClock();
    old.ingest({ position: 30, playing: true, updated_at: stamp, now: T0 + 2500, rttMs: 400, receivedAt: 1000 });
    expect(old.positionAt(1000)).toBeCloseTo(32.7, 5);
    // A `took` longer than the round trip (clock grain) never goes negative.
    const odd = new HostClock();
    odd.ingest({ position: 30, playing: true, updated_at: stamp, now: T0, took: 900, rttMs: 400, receivedAt: 0 });
    expect(odd.positionAt(0)).toBeCloseTo(30.4, 5);
  });

  it('a slow, lopsided poll changes nothing: the quickest of the last few polls sets the clock', () => {
    const stamp = new Date(T0).toISOString();
    const c = new HostClock();
    // `late`: how much longer the answer took to come back than the question took to go.
    const poll = (sec: number, rtt: number, late = 0) =>
      c.ingest({ position: 10, playing: true, updated_at: stamp, now: T0 + sec * 1000 - (rtt + late) / 2, rttMs: rtt, receivedAt: sec * 1000, songId: 'a' });
    for (let s = 0; s <= 8; s += 2) poll(s, 40);
    expect(c.positionAt(8000)).toBeCloseTo(18, 5);
    // 600 ms round trip, 500 of it on the way back: on its own this reading is 250 ms wrong.
    poll(10, 600, 500);
    expect(c.positionAt(10_000)).toBeCloseTo(20, 5);
    // A minute and a half later the quick polls are too old to go on: the
    // best of the slow ones is used (50 ms out).
    for (let s = 12; s <= 92; s += 2) poll(s, 600, 100);
    expect(c.positionAt(92_000)).toBeCloseTo(101.95, 5);
  });

  it('the push sent while the host’s own audio was still starting is replaced by the next one', () => {
    const stamp = (ms: number) => new Date(T0 + ms).toISOString();
    const c = new HostClock();
    // "Playing, 0:00" the instant the host tapped a song…
    c.ingest({ position: 0, playing: true, updated_at: stamp(0), now: T0 + 100, rttMs: 0, receivedAt: 100, songId: 'a' });
    expect(c.positionAt(100)).toBeCloseTo(0.1, 5);
    // …but sound only came 200 ms later: at 1.0 s the host says it is at 0.8.
    c.ingest({ position: 0.8, playing: true, updated_at: stamp(1000), now: T0 + 2100, rttMs: 0, receivedAt: 2100, songId: 'a' });
    expect(c.positionAt(2100)).toBeCloseTo(1.9, 5);
  });

  it('after that, a push that disagrees a little moves the estimate half way; the same push read twice counts once', () => {
    const stamp = (ms: number) => new Date(T0 + ms).toISOString();
    const c = new HostClock();
    const poll = (sec: number, position: number, pushedSec: number) =>
      c.ingest({ position, playing: true, updated_at: stamp(pushedSec * 1000), now: T0 + sec * 1000, rttMs: 0, receivedAt: sec * 1000, songId: 'a' });
    poll(0, 10, 0);
    poll(2, 12, 2);
    poll(4, 14, 4);
    expect(c.positionAt(4000)).toBeCloseTo(14, 5);
    // This push says 100 ms further on than the line so far (16.1, not 16).
    poll(6, 16.1, 6);
    expect(c.positionAt(6000)).toBeCloseTo(16.05, 5);
    poll(8, 16.1, 6);
    expect(c.positionAt(8000)).toBeCloseTo(18.05, 5);
  });

  it('the push that reports a seek is sent while the audio refills: the next one replaces it', () => {
    const stamp = (ms: number) => new Date(T0 + ms).toISOString();
    const c = new HostClock();
    const poll = (ms: number, position: number, pushedMs: number) =>
      c.ingest({ position, playing: true, updated_at: stamp(pushedMs), now: T0 + ms, rttMs: 0, receivedAt: ms, songId: 'a' });
    poll(0, 10, 0);
    poll(2000, 12, 2000);
    poll(4000, 14, 4000);
    // The host seeks to 80 s at 5 s; sound comes back 60 ms later.
    poll(6000, 80, 5000);
    expect(c.positionAt(6000)).toBeCloseTo(81, 5);
    // 0.5 s on, the host says where the playhead really is: 80.44, not 80.5.
    poll(8000, 80.44, 5500);
    expect(c.positionAt(8000)).toBeCloseTo(82.94, 5);
  });

  it('a real jump is taken at once: a stall, a seek, a new song, a pause', () => {
    const stamp = (ms: number) => new Date(T0 + ms).toISOString();
    const c = new HostClock();
    const poll = (ms: number, position: number, songId: string, playing = true) =>
      c.ingest({ position, playing, updated_at: stamp(ms), now: T0 + ms, rttMs: 0, receivedAt: ms, songId });
    poll(0, 10, 'a');
    poll(2000, 12, 'a');
    // The host's stream stalled for 0.4 s.
    poll(4000, 13.6, 'a');
    expect(c.positionAt(4000)).toBeCloseTo(13.6, 5);
    // The host seeked forward a minute.
    poll(6000, 75.6, 'a');
    expect(c.positionAt(6000)).toBeCloseTo(75.6, 5);
    // A new song that happens to be near the same spot still re-anchors.
    poll(8000, 77.7, 'b');
    expect(c.positionAt(8000)).toBeCloseTo(77.7, 5);
    expect(c.songId).toBe('b');
    // A pause is exact, and stays put.
    poll(10_000, 79.1, 'b', false);
    expect(c.positionAt(13_000)).toBe(79.1);
    expect(CLOCK_SNAP_S).toBeLessThan(0.5);
  });

  it('knows when it has something to say', () => {
    const c = new HostClock();
    expect(c.ready).toBe(false);
    c.ingest({ position: 1, playing: true, updated_at: new Date(T0).toISOString(), now: T0, receivedAt: 0, songId: 'a' });
    expect(c.ready).toBe(true);
    expect(c.isPlaying).toBe(true);
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
  it('does not seek inside the threshold: that gap is closed by speed', () => {
    expect(decideCorrection({ ...base, expected: 30.3, local: playing() }).kind).toBe('none');
    expect(decideCorrection({ ...base, expected: 30 + SEEK_THRESHOLD_S + 0.05, local: playing() }).kind).toBe('seek');
    expect(SEEK_THRESHOLD_S).toBeLessThan(0.6);
  });
  it('a paused host is matched to the spot: a seek while paused is silent', () => {
    const paused = { ...base, hostPlaying: false, local: playing({ isPlaying: false }) };
    expect(decideCorrection({ ...paused, expected: 30.1 }).kind).toBe('none');
    expect(decideCorrection({ ...paused, expected: 30.3 })).toMatchObject({ kind: 'seek', to: 30.3 });
  });
  it('seeks when drift passes the threshold, and reports the drift', () => {
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
  it('waits for the host’s next song when ours ran out a moment early, instead of starting it again', () => {
    const ended = playing({ isPlaying: false, currentTime: 200, duration: 200 });
    expect(decideCorrection({ ...base, expected: 199.2, local: ended }).kind).toBe('none');
    expect(decideCorrection({ ...base, expected: 203, local: ended }).kind).toBe('none');
    // Paused mid-song is still a pause to undo.
    expect(decideCorrection({ ...base, expected: 120, local: playing({ isPlaying: false, currentTime: 120, duration: 200 }) }).kind).toBe('play');
  });
  it('a seek aims ahead of a playing host by the time seeks take, never of a paused one', () => {
    expect(decideCorrection({ ...base, expected: 32, seekLeadS: 0.4, local: playing() })).toMatchObject({ kind: 'seek', to: 32.4, drift: -2 });
    const paused = decideCorrection({ ...base, hostPlaying: false, expected: 40, seekLeadS: 0.4, local: playing({ isPlaying: false }) });
    expect(paused).toMatchObject({ kind: 'seek', to: 40 });
    // The lead never carries a seek past the end either.
    expect(decideCorrection({ ...base, expected: 199.4, seekLeadS: 1, local: playing({ currentTime: 100, duration: 200 }) })).toMatchObject({ kind: 'seek', to: 199.5 });
  });
  it('never seeks past the end of the song', () => {
    const c = decideCorrection({ ...base, expected: 260, local: playing({ currentTime: 100, duration: 200 }) });
    expect(c).toMatchObject({ kind: 'seek', to: 199.5 });
  });
});

describe('ServerClock (what moment is it on the server?)', () => {
  it('is not ready until an answer carries the server clock', () => {
    const c = new ServerClock();
    expect(c.ready).toBe(false);
    expect(c.add({ rttMs: 40, receivedAt: 0 })).toBe(false);
    expect(c.ready).toBe(false);
    expect(c.add({ now: T0, took: 0, rttMs: 40, receivedAt: 1000 })).toBe(true);
    expect(c.ready).toBe(true);
  });

  it('reads the server moment for any moment on this device', () => {
    const c = new ServerClock();
    // Asked at 880, answered at 1000: 120 ms round trip, 80 of it the server's.
    c.add({ now: T0, took: 80, rttMs: 120, receivedAt: 1000 });
    // Arrived at T0, answered 80 ms later, 20 ms of flight back.
    expect(c.at(1000)).toBeCloseTo(T0 + 100, 5);
    expect(c.at(1500)).toBeCloseTo(T0 + 600, 5);
    // The moment a position was read, a little before it is sent.
    expect(c.at(940)).toBeCloseTo(T0 + 40, 5);
  });

  it('a host and a guest that both keep it agree, whatever each message took', () => {
    // The same server clock seen from two devices with different local clocks.
    const host = new ServerClock();
    const guest = new ServerClock();
    host.add({ now: T0, took: 200, rttMs: 260, receivedAt: 5000 }); // 30 ms each way
    guest.add({ now: T0 + 1000, took: 250, rttMs: 430, receivedAt: 90_000 }); // 90 ms each way
    // The host reads its playhead (60 s) at its 5200; that is server T0 + 430.
    const stamp = host.at(5200);
    expect(stamp).toBeCloseTo(T0 + 430, 5);
    // The guest, at its 91_000 (server T0 + 2340), places the host 1.91 s further on.
    expect(60 + (guest.at(91_000) - stamp) / 1000).toBeCloseTo(61.91, 5);
  });
});

describe('RateNudge (fine sync inside the seek threshold)', () => {
  it('plays faster when behind the host and slower when ahead', () => {
    expect(new RateNudge().next(-0.4)).toBeCloseTo(1 + NUDGE_MAX, 5);
    expect(new RateNudge().next(0.4)).toBeCloseTo(1 - NUDGE_MAX, 5);
  });
  it('eases off as the gap closes, and leaves a guest that is with the host alone', () => {
    const n = new RateNudge();
    expect(n.next(-0.1)).toBeCloseTo(1.05, 5);
    expect(n.next(-0.04)).toBeCloseTo(1.02, 5);
    expect(new RateNudge().next(NUDGE_START_S - 0.01)).toBe(1);
    expect(new RateNudge().next(0)).toBe(1);
  });
  it('keeps going until it is really there, then does not start again for a hair', () => {
    const n = new RateNudge();
    expect(n.next(-0.2)).toBeGreaterThan(1);
    // Under the start line but not yet at the stop line: still closing.
    const between = (NUDGE_START_S + NUDGE_STOP_S) / 2;
    expect(n.next(-between)).toBeGreaterThan(1);
    expect(n.next(-NUDGE_STOP_S / 2)).toBe(1);
    expect(n.next(-between)).toBe(1);
    // Two phones in one room are heard as one only inside about 30 ms.
    expect(NUDGE_START_S).toBeLessThanOrEqual(0.015);
    expect(NUDGE_STOP_S).toBeLessThanOrEqual(0.005);
  });
  it('closes half a second in a few seconds without ever passing the limit', () => {
    const n = new RateNudge();
    let drift = -0.5;
    let ticks = 0;
    while (Math.abs(drift) > NUDGE_STOP_S && ticks < 400) {
      const rate = n.next(drift);
      expect(Math.abs(rate - 1)).toBeLessThanOrEqual(NUDGE_MAX + 1e-9);
      drift += (rate - 1) * 0.25; // a quarter of a second at that speed
      ticks += 1;
    }
    expect(Math.abs(drift)).toBeLessThanOrEqual(NUDGE_STOP_S);
    expect(ticks * 0.25).toBeLessThan(14);
    expect(n.next(drift)).toBe(1);
  });
  it('leaves a gap of several seconds to a seek', () => {
    expect(new RateNudge().next(-20)).toBe(1);
    expect(new RateNudge().next(Number.NaN)).toBe(1);
  });
});

describe('SeekLead', () => {
  it('aims further ahead after landing behind, and less after landing ahead', () => {
    const l = new SeekLead(0.25);
    l.learn(-0.5);
    expect(l.seconds).toBeCloseTo(0.55, 5);
    l.learn(0.3);
    expect(l.seconds).toBeCloseTo(0.37, 5);
  });
  it('stays between zero and two seconds, and ignores a gap that is not a seek’s', () => {
    const l = new SeekLead(0.25);
    l.learn(2);
    expect(l.seconds).toBe(0);
    for (let i = 0; i < 10; i += 1) l.learn(-2.5);
    expect(l.seconds).toBe(2);
    l.learn(-30);
    expect(l.seconds).toBe(2);
  });
});

describe('Flight', () => {
  it('is zero until measured, then the middle of the last five trips', () => {
    const f = new Flight();
    expect(f.ms).toBe(0);
    f.add(900); // a cold connection
    f.add(60);
    f.add(80);
    expect(f.ms).toBe(80);
    f.add(70);
    f.add(75);
    f.add(65);
    expect(f.ms).toBe(70);
    f.add(-5);
    f.add(Number.NaN);
    expect(f.ms).toBe(70);
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
