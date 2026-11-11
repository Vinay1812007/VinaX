// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createRoom: vi.fn(),
  endRoom: vi.fn(async () => undefined),
  getRoom: vi.fn(),
  heartbeat: vi.fn(async () => undefined),
  isHostOf: vi.fn(() => false),
  leaveRoom: vi.fn(async () => undefined),
  leaveRoomBeacon: vi.fn(),
  requestSong: vi.fn(async () => true),
  sendReaction: vi.fn(async () => true),
  sayInRoom: vi.fn(async (..._a: unknown[]) => true),
  voteSkip: vi.fn(async () => 1),
  myName: vi.fn(() => 'Me'),
  updateRoom: vi.fn(async (..._a: unknown[]): Promise<string> => 'ok'),
  getSong: vi.fn(),
  toast: vi.fn(),
}));

// A small stand-in for the player store: the engine only reads state and
// calls a handful of actions on it.
const player = vi.hoisted(() => {
  type S = {
    queue: Array<{ id: string }>;
    index: number;
    isPlaying: boolean;
    isBuffering: boolean;
    currentTime: number;
    duration: number;
    followMode: boolean;
    blocked: boolean;
    playSong: (s: { id: string }) => void;
    togglePlay: () => void;
    seek: (t: number) => void;
    enqueue: (s: { id: string }) => void;
    playAt: (i: number) => void;
    setFollowMode: (v: boolean) => void;
  };
  let state: S;
  const subs = new Set<(s: S) => void>();
  const set = (p: Partial<S>) => {
    state = { ...state, ...p };
    subs.forEach((f) => f(state));
  };
  const reset = () => {
    state = {
      queue: [],
      index: 0,
      isPlaying: false,
      isBuffering: false,
      currentTime: 0,
      duration: 200,
      followMode: false,
      blocked: false,
      playSong: (s: { id: string }) => set({ queue: [s], index: 0, currentTime: 0, isPlaying: !state.blocked }),
      togglePlay: () => set({ isPlaying: state.blocked ? false : !state.isPlaying }),
      seek: (t: number) => set({ currentTime: t }),
      enqueue: (s: { id: string }) => set({ queue: [...state.queue, s] }),
      playAt: (i: number) => set({ index: i, currentTime: 0 }),
      setFollowMode: (v: boolean) => set({ followMode: v }),
    };
  };
  reset();
  return { getState: () => state, set, reset, subscribe: (f: (s: S) => void) => (subs.add(f), () => subs.delete(f)) };
});

// The audio element as the sync engine sees it: which song it holds, where
// its playhead is right now, and the playback speed it was last given.
const audio = vi.hoisted(() => ({
  songId: null as string | null,
  position: (): number | null => null,
  advancing: true,
  setRate: vi.fn<(r: number) => void>(),
}));

vi.mock('@/services/together', () => ({ ...api, REACTION_EMOJI: ['🔥'] }));

// The room's live line (live.ts), stood in for: what this device sent on it,
// and a way to say something to this device as another phone in the room would.
interface FakeLine {
  code: string;
  sent: Array<[string, Record<string, unknown>]>;
  connected: boolean;
  closed: boolean;
  hear(event: string, payload: unknown): void;
}
const wire = vi.hoisted(() => ({ lines: [] as FakeLine[] }));
vi.mock('./live', () => ({
  cleanLive: (raw: unknown) => raw ?? null,
  LiveLine: class {
    code: string;
    sent: Array<[string, Record<string, unknown>]> = [];
    connected = true;
    closed = false;
    hear: (event: string, payload: unknown) => void;
    constructor(_cfg: unknown, code: string, onEvent: (event: string, payload: unknown) => void, onStatus: (open: boolean) => void) {
      this.code = code;
      this.hear = onEvent;
      wire.lines.push(this as unknown as FakeLine);
      onStatus(true);
    }
    send(event: string, payload: Record<string, unknown>): boolean {
      if (!this.connected) return false;
      this.sent.push([event, payload]);
      return true;
    }
    close(): void {
      this.closed = true;
    }
  },
}));
vi.mock('@/services/audio/engine', () => ({
  audioEngine: {
    get currentSongId() {
      return audio.songId;
    },
    position: () => audio.position(),
    isAdvancing: () => audio.advancing,
    setRate: audio.setRate,
  },
}));
vi.mock('@/services/api', () => ({ getSong: api.getSong }));
vi.mock('@/store/toastStore', () => ({ toast: api.toast }));
// What the player was told to do with a song a guest taps elsewhere in the app.
const asks = vi.hoisted(() => ({ fn: null as ((s: unknown) => void) | null }));
vi.mock('@/store/playerStore', () => ({
  usePlayerStore: { getState: player.getState, subscribe: player.subscribe },
  setRoomAsk: (fn: ((s: unknown) => void) | null) => {
    asks.fn = fn;
  },
}));

import { useTogether } from '@/services/together/session';
import { addSong, ask, getTrimMs, joinSession, leaveSession, playNow, react, runSession, say, setTrimMs, tapToListen, TRIM_MAX_MS, typing } from './engine';
import { useRoom } from './room';

const song = (id: string, playable = true) => ({ id, title: `Song ${id}`, subtitle: '', images: [], audio: playable ? [{ quality: '320kbps', url: 'u' }] : [] });
const room = (over: Record<string, unknown> = {}) => ({
  room: { host_name: 'Asha', song: song('h1'), position: 10, playing: true, updated_at: new Date().toISOString(), queue: [], requests: [], ...over },
  memberCount: 2,
  reactions: [],
  now: Date.now(),
  rttMs: 50,
  receivedAt: performance.now(),
});

beforeEach(() => {
  vi.useFakeTimers();
  player.reset();
  // Also forgets what the last test's session had learned about the host's clock.
  leaveSession();
  useTogether.getState().reset();
  Object.values(api).forEach((f) => f.mockClear());
  // mockClear keeps implementations: restore the defaults a test may override.
  api.updateRoom.mockResolvedValue('ok');
  api.requestSong.mockResolvedValue(true);
  audio.songId = null;
  audio.position = () => null;
  audio.advancing = true;
  audio.setRate.mockClear();
  setTrimMs(0);
  wire.lines.length = 0;
  api.sayInRoom.mockResolvedValue(true);
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('guest', () => {
  it('joining turns on follow mode BEFORE the first play, and plays the host song', async () => {
    api.getRoom.mockResolvedValue(room());
    const order: string[] = [];
    const orig = player.getState();
    player.set({
      setFollowMode: (v: boolean) => (order.push(`follow:${v}`), orig.setFollowMode(v)),
      playSong: (s: { id: string }) => (order.push(`play:${s.id}`), orig.playSong(s)),
    } as never);
    const r = await joinSession('abc123');
    expect(r.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['follow:true', 'play:h1']);
    expect(useTogether.getState()).toMatchObject({ mode: 'guest', code: 'ABC123', hostName: 'Asha' });
  });

  // The server keeps a song's id, title and artwork, never its streams.
  const stub = (id: string) => ({ id, title: `Song ${id}`, subtitle: 'Artist', images: [], artists: [] });

  it('joining looks the host’s song up before playing it: the room’s copy has no streams', async () => {
    api.getRoom.mockResolvedValue(room({ song: stub('r1') }));
    api.getSong.mockResolvedValue(song('r1'));
    const r = await joinSession('ABC123');
    expect(r.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getSong).toHaveBeenCalledWith('r1');
    const now = player.getState().queue[0] as unknown as { id: string; audio: unknown[] };
    expect(now.id).toBe('r1');
    expect(now.audio).toHaveLength(1);
    expect(player.getState().isPlaying).toBe(true);
  });

  it('follows the host to the next song with one lookup, and remembers only playable songs', async () => {
    api.getRoom.mockResolvedValue(room({ song: stub('r2') }));
    api.getSong.mockImplementation(async (id: string) => song(id));
    useTogether.getState().begin('guest', 'ABC123');
    const stop = runSession('guest', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    expect(player.getState().queue.map((s) => s.id)).toEqual(['r2']);
    api.getRoom.mockResolvedValue(room({ song: stub('r3') }));
    await vi.advanceTimersByTimeAsync(4000);
    expect(player.getState().queue.map((s) => s.id)).toEqual(['r3']);
    expect(api.getSong.mock.calls.map((c) => c[0])).toEqual(['r2', 'r3']);
    const played = useTogether.getState().played as unknown as Array<{ id: string; audio: unknown[] }>;
    expect(played.length).toBeGreaterThan(0);
    expect(played.every((s) => s.audio.length === 1)).toBe(true);
    stop();
  });

  it('a song this device cannot get is said once, the old song stops, and the room carries on', async () => {
    player.getState().playSong(song('old'));
    api.getRoom.mockResolvedValue(room({ song: stub('lost') }));
    api.getSong.mockRejectedValue(new Error('404'));
    useTogether.getState().begin('guest', 'ABC123');
    const stop = runSession('guest', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.getSong).toHaveBeenCalledTimes(1);
    expect(api.toast.mock.calls.filter((c) => String(c[0]).includes('Couldn’t get'))).toHaveLength(1);
    expect(useTogether.getState()).toMatchObject({ mode: 'guest', unplayable: 'lost' });
    expect(player.getState().isPlaying).toBe(false);
    // The host moves on to a song that is there: it plays and the note clears.
    api.getRoom.mockResolvedValue(room({ song: stub('r4') }));
    api.getSong.mockResolvedValue(song('r4'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(player.getState().queue.map((s) => s.id)).toEqual(['r4']);
    expect(useTogether.getState().unplayable).toBeNull();
    stop();
  });

  it('starts the song where the host is, not at the top', async () => {
    api.getRoom.mockResolvedValue(room({ position: 75 }));
    const starts: Array<number | undefined> = [];
    const orig = player.getState();
    player.set({ playSong: (s: { id: string }, o?: { startAt?: number }) => (starts.push(o?.startAt), orig.playSong(s)) } as never);
    expect((await joinSession('ABC123')).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    // 75 s when the host pushed, plus the answer's flight and the half second a new stream takes to start.
    expect(starts).toHaveLength(1);
    expect(starts[0]).toBeGreaterThan(75.4);
    expect(starts[0]).toBeLessThan(76);
  });

  it('a paused host is joined exactly where it stopped', async () => {
    api.getRoom.mockResolvedValue(room({ position: 75, playing: false }));
    const starts: Array<number | undefined> = [];
    const orig = player.getState();
    player.set({ playSong: (s: { id: string }, o?: { startAt?: number }) => (starts.push(o?.startAt), orig.playSong(s)) } as never);
    await joinSession('ABC123');
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([75]);
  });

  describe('fine sync', () => {
    // These compare positions to the millisecond, so the engine's own clock
    // (performance.now) has to move with the fake timers, not with the
    // machine: left real, a busy test run reads as drift.
    beforeEach(() => {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    });

    // The host as the guest's clock sees it: 10 s at the poll, moving on with time.
    const follow = async (offset: () => number) => {
      const t0 = performance.now();
      const hostAt = () => 10.025 + (performance.now() - t0) / 1000;
      api.getRoom.mockResolvedValue(room());
      useTogether.getState().begin('guest', 'ABC123');
      const stop = runSession('guest', 'ABC123');
      await vi.advanceTimersByTimeAsync(0);
      audio.songId = 'h1';
      audio.position = () => hostAt() + offset();
      return { stop, hostAt };
    };
    const lastRate = () => audio.setRate.mock.calls[audio.setRate.mock.calls.length - 1]?.[0];

    it('a guest a little behind plays slightly faster; a little ahead, slightly slower; in step, normally', async () => {
      let offset = -0.2;
      const { stop } = await follow(() => offset);
      // A fresh song is left to settle first.
      await vi.advanceTimersByTimeAsync(1000);
      expect(lastRate()).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(lastRate()).toBeCloseTo(1.08, 2);
      offset = 0.1;
      await vi.advanceTimersByTimeAsync(250);
      expect(lastRate()).toBeCloseTo(0.95, 2);
      offset = 0.002;
      await vi.advanceTimersByTimeAsync(250);
      expect(lastRate()).toBe(1);
      // Nothing was seeked for any of this.
      expect(player.getState().currentTime).toBe(0);
      stop();
    });

    it('does not touch the speed while the stream is waiting for data, or while the host is paused', async () => {
      const { stop } = await follow(() => -0.2);
      audio.advancing = false;
      await vi.advanceTimersByTimeAsync(2500);
      expect(audio.setRate.mock.calls.every(([r]) => r === 1)).toBe(true);
      audio.advancing = true;
      await vi.advanceTimersByTimeAsync(250);
      expect(lastRate()).toBeCloseTo(1.08, 2);
      api.getRoom.mockResolvedValue(room({ playing: false }));
      await vi.advanceTimersByTimeAsync(2500);
      expect(lastRate()).toBe(1);
      stop();
    });

    it('a guest far off seeks ahead of the host by the time a seek takes', async () => {
      // How far ahead of the host each seek aimed, at the moment it was made.
      const seeks: number[] = [];
      const orig = player.getState();
      const t0 = performance.now();
      player.set({ seek: (t: number) => (seeks.push(t - (10.025 + (performance.now() - t0) / 1000)), orig.seek(t)) } as never);
      const { stop } = await follow(() => -20);
      await vi.advanceTimersByTimeAsync(4000);
      expect(seeks).toHaveLength(1);
      // The first guess for a seek is a quarter of a second.
      expect(seeks[0]).toBeCloseTo(0.25, 2);
      stop();
    });

    it('a song that came in half a second off is put right with one early seek, not ten seconds of catching up', async () => {
      // How far ahead of the host each seek aimed, at the moment it was made.
      const seeks: number[] = [];
      const orig = player.getState();
      // A playing room, joined part-way in: the song starts in place (and its landing is measured).
      api.getRoom.mockResolvedValue(room({ position: 75 }));
      const t0 = performance.now();
      const hostAt = () => 75.025 + (performance.now() - t0) / 1000;
      player.set({ seek: (t: number) => (seeks.push(t - hostAt()), orig.seek(t)) } as never);
      await joinSession('ABC123');
      const stop = runSession('guest', 'ABC123');
      await vi.advanceTimersByTimeAsync(0);
      audio.songId = 'h1';
      audio.position = () => hostAt() + 0.6;
      await vi.advanceTimersByTimeAsync(1750);
      expect(seeks).toHaveLength(1);
      expect(seeks[0]).toBeCloseTo(0.25, 2);
      // After it, the small remainder is closed by speed alone.
      audio.position = () => hostAt() + 0.1;
      await vi.advanceTimersByTimeAsync(1000);
      expect(seeks).toHaveLength(1);
      expect(lastRate()).toBeCloseTo(0.95, 2);
      stop();
    });

    it('when the host pauses, the guest stops on the host’s spot; when it plays again, the guest starts where the host is by then', async () => {
      const seeks: number[] = [];
      const orig = player.getState();
      player.set({ seek: (t: number) => (seeks.push(t), orig.seek(t)) } as never);
      const { stop } = await follow(() => 0);
      await vi.advanceTimersByTimeAsync(4000);
      expect(seeks).toHaveLength(0);
      // The host paused at 13.2 s; this device hears of it late and is past it.
      const paused = Date.now();
      api.getRoom.mockResolvedValue({ ...room({ playing: false, position: 13.2, updated_at: new Date(paused).toISOString() }), now: paused + 600, receivedAt: performance.now() + 600 });
      audio.position = () => 14.1;
      await vi.advanceTimersByTimeAsync(2000);
      expect(player.getState().isPlaying).toBe(false);
      expect(seeks).toEqual([13.2]);
      // Three seconds later the host plays again from there; the poll that
      // says so lands 0.9 s after the host started.
      audio.position = () => 13.2;
      await vi.advanceTimersByTimeAsync(3000);
      const resumed = Date.now();
      api.getRoom.mockResolvedValue({ ...room({ playing: true, position: 13.2, updated_at: new Date(resumed - 900).toISOString() }), now: resumed, receivedAt: performance.now() });
      await vi.advanceTimersByTimeAsync(2000);
      expect(player.getState().isPlaying).toBe(true);
      expect(seeks).toHaveLength(2);
      // 13.2 + the time the host has been playing + the quarter second a seek takes.
      expect(seeks[1]).toBeGreaterThan(13.2 + 0.9 + 0.2);
      expect(seeks[1]).toBeLessThan(13.2 + 0.9 + 2.3);
      stop();
    });

    it('an answer that arrives after a newer one is ignored: a late "playing" does not restart a guest the host has paused', async () => {
      const { stop } = await follow(() => 0);
      await vi.advanceTimersByTimeAsync(4000);
      const paused = Date.now();
      audio.position = () => 14;
      api.getRoom.mockResolvedValue({ ...room({ playing: false, position: 14, updated_at: new Date(paused).toISOString() }), now: paused + 500, receivedAt: performance.now() + 500 });
      await vi.advanceTimersByTimeAsync(2000);
      expect(player.getState().isPlaying).toBe(false);
      // The poll sent before the pause lands now, saying "playing".
      api.getRoom.mockResolvedValue({ ...room({ playing: true, position: 12, updated_at: new Date(paused - 2000).toISOString() }), now: paused - 1500, receivedAt: performance.now() });
      await vi.advanceTimersByTimeAsync(4000);
      expect(player.getState().isPlaying).toBe(false);
      stop();
    });

    it('a device fine-tuned 120 ms earlier is held 120 ms ahead of the host’s signal', async () => {
      setTrimMs(120);
      // Exactly on the host's signal: for this device that is 120 ms late.
      const { stop } = await follow(() => 0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(lastRate()).toBeCloseTo(1.06, 2);
      stop();
    });

    it('the fine-tune is kept on the device and stays within half a second either way', () => {
      expect(setTrimMs(40)).toBe(40);
      expect(getTrimMs()).toBe(40);
      expect(JSON.parse(localStorage.getItem('vinax.together-trim.v1') ?? 'null')).toBe(40);
      expect(setTrimMs(9000)).toBe(TRIM_MAX_MS);
      expect(setTrimMs(-9000)).toBe(-TRIM_MAX_MS);
      expect(setTrimMs(Number.NaN)).toBe(0);
    });

    it('leaving gives the listener their own playback speed back', async () => {
      const { stop } = await follow(() => -0.2);
      await vi.advanceTimersByTimeAsync(2000);
      expect(lastRate()).toBeCloseTo(1.08, 2);
      player.set({ rate: 1.25 } as never);
      stop();
      expect(lastRate()).toBe(1.25);
    });
  });

  it('rejects a malformed code without a network call', async () => {
    const r = await joinSession('a!');
    expect(r.ok).toBe(false);
    expect(api.getRoom).not.toHaveBeenCalled();
  });

  it('raises "tap to listen" when the browser keeps audio blocked', async () => {
    api.getRoom.mockResolvedValue(room());
    player.set({ blocked: true });
    useTogether.getState().begin('guest', 'ABC123');
    const stop = runSession('guest', 'ABC123');
    await vi.advanceTimersByTimeAsync(0); // first tick: loads the host song (blocked)
    await vi.advanceTimersByTimeAsync(4000); // after the cooldown: asks to play again
    expect(useTogether.getState().needsTap).toBe(true);
    // The tap unblocks and clears the prompt.
    player.set({ blocked: false });
    tapToListen();
    expect(player.getState().isPlaying).toBe(true);
    expect(useTogether.getState().needsTap).toBe(false);
    stop();
    expect(player.getState().followMode).toBe(false);
  });

  it('a room that disappears ends the session with a message', async () => {
    api.getRoom.mockResolvedValue({ room: null, memberCount: 0, reactions: [] });
    useTogether.getState().begin('guest', 'ABC123');
    const stop = runSession('guest', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    expect(useTogether.getState().mode).toBe('idle');
    expect(api.toast).toHaveBeenCalledWith('The host ended the session');
    stop();
  });

  it('a song request reports failure honestly', async () => {
    useTogether.getState().begin('guest', 'ABC123');
    api.requestSong.mockResolvedValueOnce(false);
    expect(await addSong(song('x') as never)).toMatch(/Couldn’t send/);
  });

  it('a song tapped anywhere in the app is asked of the host, once', async () => {
    api.getRoom.mockResolvedValue({ ...room({ queue: [{ song: song('q1'), by: null }] }), live: { url: 'wss://abcdefgh.supabase.co/realtime/v1', key: 'sb_publishable_test' } });
    useTogether.getState().begin('guest', 'ABC123');
    const stop = runSession('guest', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    // The player hands taps to the room while this device follows a host.
    expect(asks.fn).toBeTypeOf('function');
    api.requestSong.mockClear();
    api.toast.mockClear();
    asks.fn?.(song('x'));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.requestSong).toHaveBeenCalledTimes(1);
    expect(lastToast()).toMatch(/Asked Asha for “Song x”/);
    // The host is told to read the room now.
    expect(wire.lines[wire.lines.length - 1]?.sent.some((m) => m[0] === 'poke')).toBe(true);
    // A second tap, the song playing now and one already up next ask nothing.
    await ask(song('x') as never);
    await ask(song('h1') as never);
    await ask(song('q1') as never);
    expect(api.requestSong).toHaveBeenCalledTimes(1);
    expect(lastToast()).toMatch(/already on its way/);
    // A request the server refused can be asked again.
    api.requestSong.mockResolvedValueOnce(false);
    await ask(song('y') as never);
    await ask(song('y') as never);
    expect(api.requestSong).toHaveBeenCalledTimes(3);
    stop();
    // Out of the room, taps play here again.
    expect(asks.fn).toBeNull();
  });
});

const lastToast = (): string => String((api.toast.mock.calls[api.toast.mock.calls.length - 1] as unknown[] | undefined)?.[0] ?? '');

describe('host', () => {
  it('adopts a guest request by looking up the full, playable song', async () => {
    const stub = { id: 'g1', title: 'Requested', subtitle: '', image: 'i' };
    api.getRoom.mockResolvedValue(room({ requests: [{ song: stub, by: 'Ravi' }] }));
    api.getSong.mockResolvedValue(song('g1'));
    useTogether.getState().begin('host', 'ABC123');
    const stop = runSession('host', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getSong).toHaveBeenCalledWith('g1');
    expect(player.getState().queue.map((s) => s.id)).toEqual(['g1']);
    // The host is told who asked, and can bring the song on at once.
    const told = api.toast.mock.calls.find(([m]) => m === 'Ravi asked for “Song g1”');
    expect(told?.[1]?.action?.label).toBe('Play now');
    // The next poll repeats the request (until the server drops it): no double add.
    await vi.advanceTimersByTimeAsync(4000);
    expect(player.getState().queue).toHaveLength(1);
    stop();
  });

  it('“Play now” brings a song that is up next on, for the host only', () => {
    player.set({ queue: [song('a'), song('b'), song('g1')], index: 0 });
    useTogether.getState().begin('guest', 'ABC123');
    playNow('g1');
    expect(player.getState().index).toBe(0);
    useTogether.getState().begin('host', 'ABC123');
    playNow('nope');
    expect(player.getState().index).toBe(0);
    playNow('g1');
    expect(player.getState().index).toBe(2);
  });

  it('an unavailable request is reported, not queued as an unplayable stub', async () => {
    api.getRoom.mockResolvedValue(room({ requests: [{ song: { id: 'gone', title: 'Lost' }, by: null }] }));
    api.getSong.mockRejectedValue(new Error('404'));
    useTogether.getState().begin('host', 'ABC123');
    const stop = runSession('host', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    expect(player.getState().queue).toHaveLength(0);
    expect(api.toast).toHaveBeenCalledWith(expect.stringContaining('Couldn’t add “Lost”'));
    stop();
  });

  it('stops "broadcasting to nobody" when the server says the room is gone', async () => {
    api.getRoom.mockResolvedValue(room());
    api.updateRoom.mockResolvedValue('gone');
    useTogether.getState().begin('host', 'ABC123');
    const stop = runSession('host', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    expect(useTogether.getState().mode).toBe('idle');
    stop();
  });

  it('pushes the playhead as the audio element has it, not the store’s older copy', async () => {
    api.getRoom.mockResolvedValue(room());
    player.set({ queue: [song('a')], index: 0, isPlaying: true, currentTime: 42 });
    audio.songId = 'a';
    audio.position = () => 42.2;
    useTogether.getState().begin('host', 'ABC123');
    const stop = runSession('host', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    const calls = api.updateRoom.mock.calls as unknown as unknown[][];
    expect(calls[calls.length - 1][2]).toBe(42.2);
    // The instant the song changes the element still holds the old one: the
    // new song is announced from its own start, never the old song's position.
    api.updateRoom.mockClear();
    player.getState().playSong(song('next'));
    await vi.advanceTimersByTimeAsync(0);
    const after = api.updateRoom.mock.calls as unknown as unknown[][];
    expect(after[after.length - 1][1]).toMatchObject({ id: 'next' });
    expect(after[after.length - 1][2]).toBe(0);
    stop();
  });

  it('once it knows the server’s clock, every push says at which server moment its position was read', async () => {
    const serverNow = Date.now() + 5_000_000; // the server's clock is nothing like this device's
    api.getRoom.mockResolvedValue({ ...room(), now: serverNow, took: 0, rttMs: 0, receivedAt: performance.now() });
    player.set({ queue: [song('a')], index: 0, isPlaying: true, currentTime: 42 });
    useTogether.getState().begin('host', 'ABC123');
    const stop = runSession('host', 'ABC123');
    // The very first push leaves before any poll has answered: no moment yet.
    expect((api.updateRoom.mock.calls as unknown as unknown[][])[0][6]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    const calls = api.updateRoom.mock.calls as unknown as unknown[][];
    const at = calls[calls.length - 1][6] as number;
    expect(typeof at).toBe('number');
    expect(Math.abs(at - serverNow)).toBeLessThan(1000);
    stop();
  });

  it('tells the room where the playhead is once a stalled stream is moving again', async () => {
    api.getRoom.mockResolvedValue(room());
    player.set({ queue: [song('a')], index: 0, isPlaying: true, currentTime: 30 });
    useTogether.getState().begin('host', 'ABC123');
    const stop = runSession('host', 'ABC123');
    // Let the opening pushes finish (the first store change always pushes,
    // and once more when the audio is moving).
    player.set({});
    await vi.advanceTimersByTimeAsync(1000);
    api.updateRoom.mockClear();
    audio.advancing = false;
    player.set({ isBuffering: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.updateRoom).not.toHaveBeenCalled();
    // Data is back, and a moment later sound is: one push, with the real position.
    player.set({ isBuffering: false });
    await vi.advanceTimersByTimeAsync(300);
    expect(api.updateRoom).not.toHaveBeenCalled();
    audio.advancing = true;
    await vi.advanceTimersByTimeAsync(600);
    expect(api.updateRoom).toHaveBeenCalledTimes(1);
    stop();
  });

  it('pushes again once the sound is really out: the first "playing" is sent before the audio starts', async () => {
    api.getRoom.mockResolvedValue(room());
    player.set({ queue: [song('a')], index: 0, isPlaying: false, currentTime: 30 });
    audio.songId = 'a';
    audio.advancing = false;
    let at = 30;
    audio.position = () => at;
    useTogether.getState().begin('host', 'ABC123');
    const stop = runSession('host', 'ABC123');
    await vi.advanceTimersByTimeAsync(100);
    api.updateRoom.mockClear();
    // The host taps play: said at once…
    player.set({ isPlaying: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.updateRoom).toHaveBeenCalledTimes(1);
    // …the stream takes 0.7 s to start, and nothing more is said meanwhile…
    await vi.advanceTimersByTimeAsync(700);
    expect(api.updateRoom).toHaveBeenCalledTimes(1);
    // …then it moves, and the room is told where the playhead really is.
    audio.advancing = true;
    at = 30.4;
    await vi.advanceTimersByTimeAsync(600);
    const calls = api.updateRoom.mock.calls as unknown as unknown[][];
    expect(calls).toHaveLength(2);
    expect(calls[1][2]).toBe(30.4);
    // Once more two seconds in, when the audio is past its start-up…
    at = 32.4;
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.updateRoom).toHaveBeenCalledTimes(3);
    expect((api.updateRoom.mock.calls as unknown as unknown[][])[2][2]).toBe(32.4);
    // …and then not on every look (the next push is the regular one, at 4 s).
    await vi.advanceTimersByTimeAsync(500);
    expect(api.updateRoom).toHaveBeenCalledTimes(3);
    stop();
  });

  it('pushes immediately when the host changes song', async () => {
    api.getRoom.mockResolvedValue(room());
    useTogether.getState().begin('host', 'ABC123');
    const stop = runSession('host', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    api.updateRoom.mockClear();
    player.getState().playSong(song('next'));
    await vi.advanceTimersByTimeAsync(0);
    const calls = api.updateRoom.mock.calls as unknown as unknown[][];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][1]).toMatchObject({ id: 'next' });
    stop();
  });
});

describe('1.13 — the live line', () => {
  // Positions are compared closely here: the engine's clock moves with the fake timers.
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  });

  const LIVE = { url: 'wss://abcdefgh.supabase.co/realtime/v1', key: 'sb_publishable_test' };
  const liveRoom = (over: Record<string, unknown> = {}) => ({ ...room(over), live: LIVE });
  const line = () => wire.lines[wire.lines.length - 1];

  /** A guest in a room whose host is playing h1, with the song loaded and the live line up. */
  const guest = async () => {
    api.getRoom.mockResolvedValue(liveRoom());
    useTogether.getState().begin('guest', 'ABC123');
    const stop = runSession('guest', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    audio.songId = 'h1';
    audio.position = () => player.getState().currentTime;
    return stop;
  };

  it('opens the line the server names, once, and closes it with the session', async () => {
    const stop = await guest();
    await vi.advanceTimersByTimeAsync(4100);
    expect(wire.lines).toHaveLength(1);
    expect(line().code).toBe('ABC123');
    expect(useRoom.getState().online).toBe(true);
    stop();
    expect(line().closed).toBe(true);
  });

  it('a room with no live line is followed by polling alone, as before', async () => {
    api.getRoom.mockResolvedValue(room());
    useTogether.getState().begin('guest', 'ABC123');
    const stop = runSession('guest', 'ABC123');
    await vi.advanceTimersByTimeAsync(2100);
    expect(wire.lines).toHaveLength(0);
    expect(player.getState().queue[0]?.id).toBe('h1');
    stop();
  });

  it('the host pauses: the guest stops at once, where the host stopped, without waiting for a poll', async () => {
    const stop = await guest();
    expect(player.getState().isPlaying).toBe(true);
    const polls = api.getRoom.mock.calls.length;
    line().hear('state', { song: { id: 'h1', title: 'Song h1' }, position: 12.5, playing: false, at: Date.now() });
    expect(player.getState().isPlaying).toBe(false);
    expect(player.getState().currentTime).toBe(12.5);
    expect(api.getRoom.mock.calls.length).toBe(polls);
    // A poll that still holds the host's older push (playing) does not start it again…
    api.getRoom.mockResolvedValue(liveRoom({ updated_at: new Date(Date.now() - 1500).toISOString() }));
    await vi.advanceTimersByTimeAsync(4100);
    expect(player.getState().isPlaying).toBe(false);
    // …and the host's play, said on the line, does: in place, with no seek and no silence.
    const seeks: number[] = [];
    const orig = player.getState();
    player.set({ seek: (t: number) => (seeks.push(t), orig.seek(t)) } as never);
    line().hear('state', { song: { id: 'h1', title: 'Song h1' }, position: 12.5, playing: true, at: Date.now() });
    expect(player.getState().isPlaying).toBe(true);
    expect(seeks).toEqual([]);
    stop();
  });

  it('the server is the truth: something said on the line that it never confirms is undone', async () => {
    const stop = await guest();
    line().hear('state', { song: { id: 'h1', title: 'Song h1' }, position: 12.5, playing: false, at: Date.now() });
    expect(player.getState().isPlaying).toBe(false);
    // Five seconds on the server still says the host is playing: a prank, or a push that never landed.
    api.getRoom.mockImplementation(async () => liveRoom({ updated_at: new Date(Date.now() - 20_000).toISOString() }));
    await vi.advanceTimersByTimeAsync(8100);
    expect(player.getState().isPlaying).toBe(true);
    stop();
  });

  it('the host moves on: the guest starts the new song from the line, and shows it at once', async () => {
    const stop = await guest();
    api.getSong.mockResolvedValue(song('h2'));
    line().hear('state', { song: { id: 'h2', title: 'Song h2', audio: [{ url: 'https://evil.example/x.mp3' }] }, position: 0.2, playing: true, at: Date.now() });
    // The stub on the line is only what a room shows: the stream is this device's own lookup.
    expect(useTogether.getState().hostSong).toMatchObject({ id: 'h2', title: 'Song h2' });
    expect((useTogether.getState().hostSong as { audio?: unknown }).audio).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getSong).toHaveBeenCalledWith('h2');
    expect(player.getState().queue[0]?.id).toBe('h2');
    stop();
  });

  it('a state that cannot be right is not acted on: this device asks the server instead', async () => {
    const stop = await guest();
    await vi.advanceTimersByTimeAsync(1000);
    const polls = api.getRoom.mock.calls.length;
    for (const bad of [
      { song: { id: 'h1' }, position: 12, playing: false, at: Date.now() + 60_000 },
      { song: { id: 'h1' }, position: 12, playing: false, at: Date.now() - 60_000 },
      { song: { id: 'h1' }, position: -4, playing: false, at: Date.now() },
      { song: { id: 'h1' }, position: 'now', playing: false, at: Date.now() },
      null,
    ]) line().hear('state', bad);
    expect(player.getState().isPlaying).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    // One look at the server for the lot, not one each.
    expect(api.getRoom.mock.calls.length).toBe(polls + 1);
    stop();
  });

  it('the host says every change on the line with the server moment its playhead was read at', async () => {
    api.getRoom.mockResolvedValue(liveRoom());
    player.set({ queue: [song('a')], index: 0, isPlaying: true, currentTime: 20 });
    audio.songId = 'a';
    audio.position = () => 20;
    useTogether.getState().begin('host', 'ABC123');
    const stop = runSession('host', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    const said = () => line().sent.filter(([e]) => e === 'state');
    expect(said().length).toBeGreaterThan(0);
    const before = said().length;
    player.set({ isPlaying: false });
    // At once: not after the push to the server has come back.
    const last = said()[said().length - 1][1];
    expect(said().length).toBe(before + 1);
    expect(last).toMatchObject({ playing: false, position: 20, song: { id: 'a', title: 'Song a' } });
    expect(Math.abs((last.at as number) - Date.now())).toBeLessThan(200);
    // Never a stream address.
    expect(JSON.stringify(last)).not.toContain('320kbps');
    stop();
  });

  it('a chat line is on the sender’s screen at once, goes down the line and to the server under one id', async () => {
    const stop = await guest();
    let stored: (ok: boolean) => void = () => undefined;
    api.sayInRoom.mockImplementation(() => new Promise<boolean>((r) => (stored = r)));
    const sent = say('  hello there  ');
    const mine = useRoom.getState().extra[0];
    expect(mine).toMatchObject({ by: 'Me', text: 'hello there', mine: true, state: 'sending' });
    expect(line().sent.find(([e]) => e === 'chat')?.[1]).toEqual({ id: mine.id, by: 'Me', text: 'hello there' });
    expect(api.sayInRoom).toHaveBeenCalledWith('ABC123', 'hello there', mine.id);
    stored(true);
    expect(await sent).toBe(true);
    expect(useRoom.getState().extra[0].state).toBe('sent');
    // The server lists it: the copy in flight is let go.
    api.getRoom.mockResolvedValue(liveRoom({ messages: [{ by: 'Me', text: 'hello there', at: new Date().toISOString(), id: mine.id }] }));
    await vi.advanceTimersByTimeAsync(2100);
    expect(useRoom.getState().extra).toHaveLength(0);
    expect(useTogether.getState().messages).toHaveLength(1);
    stop();
  });

  it('a line neither the line nor the server took is marked, and can be sent again as the same line', async () => {
    const stop = await guest();
    line().connected = false;
    api.sayInRoom.mockResolvedValue(false);
    expect(await say('lost')).toBe(false);
    const failed = useRoom.getState().extra[0];
    expect(failed.state).toBe('failed');
    api.sayInRoom.mockResolvedValue(true);
    expect(await say('lost', failed.id)).toBe(true);
    expect(useRoom.getState().extra).toHaveLength(1);
    expect(useRoom.getState().extra[0]).toMatchObject({ id: failed.id, state: 'sent' });
    stop();
  });

  it('someone else’s line and their "typing" show as they happen; junk on the line shows nothing', async () => {
    const stop = await guest();
    line().hear('typing', { by: 'Asha' });
    expect(useRoom.getState().typing).toEqual(['Asha']);
    line().hear('chat', { id: 'abcdef123456', by: 'Asha', text: 'hi all' });
    expect(useRoom.getState().typing).toEqual([]);
    expect(useRoom.getState().extra).toMatchObject([{ id: 'abcdef123456', by: 'Asha', text: 'hi all', mine: false, state: 'sent' }]);
    line().hear('chat', { id: '<img>', by: 'Asha', text: 'x' });
    line().hear('chat', { id: 'abcdef123457', by: 'Asha', text: '   ' });
    line().hear('chat', { id: 'abcdef123458', by: 'Asha', text: 7 });
    line().hear('typing', {});
    line().hear('nonsense', { anything: true });
    expect(useRoom.getState().extra).toHaveLength(1);
    expect(useRoom.getState().typing).toEqual([]);
    stop();
  });

  it('says "typing" while the listener types, not on every key, and stops when the field is cleared', async () => {
    const stop = await guest();
    const typed = () => line().sent.filter(([e]) => e === 'typing');
    typing(true);
    typing(true);
    typing(true);
    expect(typed()).toEqual([['typing', { by: 'Me' }]]);
    await vi.advanceTimersByTimeAsync(2600);
    typing(true);
    expect(typed()).toHaveLength(2);
    typing(false);
    expect(typed()[2]).toEqual(['typing', { by: 'Me', on: false }]);
    typing(false);
    expect(typed()).toHaveLength(3);
    stop();
  });

  it('a reaction rises on every screen at once, with who sent it, and its echo in the next poll is not shown twice', async () => {
    const stop = await guest();
    line().hear('react', { e: '🔥', by: 'Asha' });
    expect(useRoom.getState().floats.filter((f) => f.by === 'Asha')).toHaveLength(1);
    line().hear('react', { e: '💀', by: 'Asha' });
    const shown = useRoom.getState().floats.length;
    expect(shown).toBe(4);
    api.getRoom.mockResolvedValue(liveRoom({}));
    api.getRoom.mockImplementation(async () => ({ ...liveRoom(), reactions: [{ e: '🔥', at: 'r1' }] }));
    await vi.advanceTimersByTimeAsync(2100);
    expect(useRoom.getState().floats.length).toBeLessThanOrEqual(shown);
    // Mine goes down the line as well as to the server.
    react('🔥');
    expect(line().sent.find(([e]) => e === 'react')?.[1]).toEqual({ e: '🔥', by: 'Me' });
    expect(api.sendReaction).toHaveBeenCalledWith('ABC123', '🔥');
    stop();
  });

  it('a guest’s request asks the host to read the room now, and the host does', async () => {
    const stop = await guest();
    await addSong(song('g1') as never);
    expect(line().sent.some(([e]) => e === 'poke')).toBe(true);
    stop();

    wire.lines.length = 0;
    api.getRoom.mockResolvedValue(liveRoom());
    useTogether.getState().begin('host', 'ABC123');
    const stopHost = runSession('host', 'ABC123');
    await vi.advanceTimersByTimeAsync(0);
    const polls = api.getRoom.mock.calls.length;
    line().hear('poke', {});
    line().hear('poke', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getRoom.mock.calls.length).toBe(polls + 1);
    stopHost();
  });
});
