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
vi.mock('@/store/playerStore', () => ({ usePlayerStore: { getState: player.getState, subscribe: player.subscribe } }));

import { useTogether } from '@/services/together/session';
import { addSong, joinSession, leaveSession, runSession, tapToListen } from './engine';

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
      let offset = -0.3;
      const { stop } = await follow(() => offset);
      // A fresh song is left to settle first.
      await vi.advanceTimersByTimeAsync(1000);
      expect(lastRate()).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(lastRate()).toBeCloseTo(1.08, 2);
      offset = 0.1;
      await vi.advanceTimersByTimeAsync(250);
      expect(lastRate()).toBeCloseTo(0.95, 2);
      offset = 0.01;
      await vi.advanceTimersByTimeAsync(250);
      expect(lastRate()).toBe(1);
      // Nothing was seeked for any of this.
      expect(player.getState().currentTime).toBe(0);
      stop();
    });

    it('does not touch the speed while the stream is waiting for data, or while the host is paused', async () => {
      const { stop } = await follow(() => -0.3);
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

    it('leaving gives the listener their own playback speed back', async () => {
      const { stop } = await follow(() => -0.3);
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
});

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
    expect(api.toast).toHaveBeenCalledWith('Ravi added “Song g1”');
    // The next poll repeats the request (until the server drops it): no double add.
    await vi.advanceTimersByTimeAsync(4000);
    expect(player.getState().queue).toHaveLength(1);
    stop();
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
    // Once, not on every look.
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.updateRoom).toHaveBeenCalledTimes(2);
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
