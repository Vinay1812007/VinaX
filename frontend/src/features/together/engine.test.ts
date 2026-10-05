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

vi.mock('@/services/together', () => ({ ...api, REACTION_EMOJI: ['🔥'] }));
vi.mock('@/services/api', () => ({ getSong: api.getSong }));
vi.mock('@/store/toastStore', () => ({ toast: api.toast }));
vi.mock('@/store/playerStore', () => ({ usePlayerStore: { getState: player.getState, subscribe: player.subscribe } }));

import { useTogether } from '@/services/together/session';
import { addSong, joinSession, runSession, tapToListen } from './engine';

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
  useTogether.getState().reset();
  Object.values(api).forEach((f) => f.mockClear());
  // mockClear keeps implementations: restore the defaults a test may override.
  api.updateRoom.mockResolvedValue('ok');
  api.requestSong.mockResolvedValue(true);
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
    expect(order).toEqual(['follow:true', 'play:h1']);
    expect(useTogether.getState()).toMatchObject({ mode: 'guest', code: 'ABC123', hostName: 'Asha' });
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
