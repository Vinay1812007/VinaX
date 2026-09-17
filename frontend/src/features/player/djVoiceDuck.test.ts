// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeSong {
  id: string;
  title: string;
  subtitle: string;
  artists: Array<{ name: string }>;
}
interface FakePlayer {
  queue: FakeSong[];
  index: number;
  isPlaying: boolean;
  followMode: boolean;
  muted: boolean;
  volume: number;
}
type Sub = (state: FakePlayer, prev: FakePlayer) => void;

const h = vi.hoisted(() => ({
  player: { queue: [], index: 0, isPlaying: false, followMode: false, muted: false, volume: 0.8 } as FakePlayer,
  subs: [] as Sub[],
  speaking: [] as Array<(id: string | null) => void>,
  cast: { connected: false },
  setVolume: vi.fn<(v: number) => void>(),
  readAloud: vi.fn<(id: string, text: string) => void>(),
}));

vi.mock('@/store/playerStore', () => ({
  usePlayerStore: { getState: () => h.player, subscribe: (fn: Sub) => h.subs.push(fn) },
}));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ djVoice: true }) } }));
vi.mock('@/store/djStore', () => ({ useDjStore: { getState: () => ({ segues: {} }) } }));
vi.mock('@/services/audio/engine', () => ({ audioEngine: { setVolume: h.setVolume } }));
vi.mock('@/services/cast', () => ({ useCastStore: { getState: () => h.cast } }));
vi.mock('@/features/ai/readAloud', () => ({
  onSpeakingChange: (fn: (id: string | null) => void) => h.speaking.push(fn),
  readAloud: h.readAloud,
  setReadAloudVoiceFallback: () => undefined,
  stopReadAloud: () => undefined,
}));

Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {} });
const { duckWatchdogMs, initDjVoice } = await import('./djVoice');
initDjVoice();

const speak = (id: string | null): void => h.speaking.forEach((fn) => fn(id));
const song = (id: string, title: string): FakeSong => ({ id, title, subtitle: '', artists: [{ name: 'Artist' }] });

/** Start `s` playing through the store subscription, as the player would. */
function start(s: FakeSong): void {
  const prev = { ...h.player };
  h.player = { ...h.player, queue: [s], index: 0, isPlaying: true };
  h.subs.forEach((fn) => fn(h.player, prev));
}

describe('duckWatchdogMs', () => {
  it('scales with the line and is capped at 30 s', () => {
    expect(duckWatchdogMs(100)).toBe(13_000);
    expect(duckWatchdogMs(1000)).toBe(30_000);
  });
  it('is a flat 20 s when the length is unknown', () => {
    expect(duckWatchdogMs(null)).toBe(20_000);
    expect(duckWatchdogMs(0)).toBe(20_000);
  });
});

describe('DJ voice ducking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.setVolume.mockClear();
    h.readAloud.mockClear();
    h.cast.connected = false;
    h.player = { queue: [], index: 0, isPlaying: false, followMode: false, muted: false, volume: 0.8 };
  });
  afterEach(() => {
    speak(null); // un-duck whatever the test left ducked
    vi.useRealTimers();
  });

  it('ducks while the DJ talks and restores the store volume afterwards', () => {
    speak('dj:a');
    expect(h.setVolume).toHaveBeenLastCalledWith(0.8 * 0.35);
    speak(null);
    expect(h.setVolume).toHaveBeenLastCalledWith(0.8);
  });

  it('un-ducks on its own when the voice never reports an end', () => {
    const s = song('w1', 'Watchdog');
    start(s);
    const line = h.readAloud.mock.calls[0][1];
    speak('dj:w1');
    expect(h.setVolume).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(duckWatchdogMs(line.length) - 1);
    expect(h.setVolume).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(h.setVolume).toHaveBeenCalledTimes(2);
    expect(h.setVolume).toHaveBeenLastCalledWith(0.8);
  });

  it('a normal end clears the watchdog', () => {
    speak('dj:b');
    speak(null);
    h.setVolume.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(h.setVolume).not.toHaveBeenCalled();
  });

  it('muting mid-line still restores the real volume, so un-mute is audible', () => {
    speak('dj:c');
    h.player = { ...h.player, muted: true };
    speak(null);
    expect(h.setVolume).toHaveBeenLastCalledWith(0.8);
  });

  it('restores silence while casting — the receiver owns the audio', () => {
    speak('dj:d');
    h.cast.connected = true;
    speak(null);
    expect(h.setVolume).toHaveBeenLastCalledWith(0);
  });

  it('does not duck a muted player or for non-DJ speech', () => {
    h.player = { ...h.player, muted: true };
    speak('dj:e');
    speak(null);
    h.player = { ...h.player, muted: false };
    speak('reply-1');
    expect(h.setVolume).not.toHaveBeenCalled();
  });
});
