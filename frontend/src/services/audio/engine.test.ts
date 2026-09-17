// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/downloads', () => ({ getOfflineSources: () => [] }));
const { orderedSources, recoveryAction } = await import('./engine');

const song = (qualities: string[]): Song =>
  ({ audio: qualities.map((quality, i) => ({ quality, url: String.fromCharCode(97 + i) })) } as unknown as Song);

describe('orderedSources', () => {
  const s = song(['48kbps', '160kbps', '320kbps']); // a=48 b=160 c=320

  it('high preference puts the highest bitrate first', () => {
    expect(orderedSources(s, 'high')[0]).toBe('c');
  });
  it('medium targets ~160 kbps', () => {
    expect(orderedSources(s, 'medium')[0]).toBe('b');
  });
  it('low targets ~96 kbps (nearest)', () => {
    expect(orderedSources(s, 'low')[0]).toBe('a');
  });
  it('returns [] when there are no audio variants', () => {
    expect(orderedSources(song([]), 'high')).toEqual([]);
  });
  it('drops variants without a URL', () => {
    const t = { audio: [{ quality: '320kbps', url: '' }, { quality: '160kbps', url: 'x' }] } as unknown as Song;
    expect(orderedSources(t, 'high')).toEqual(['x']);
  });
});

describe('recoveryAction (network-drop / handoff recovery)', () => {
  it('retries the same source once when it had been playing fine', () => {
    expect(recoveryAction(true, false)).toBe('retry-same');
  });
  it('advances after the one retry is spent', () => {
    expect(recoveryAction(true, true)).toBe('advance');
  });
  it('advances immediately for a source that never played', () => {
    expect(recoveryAction(false, false)).toBe('advance');
    expect(recoveryAction(false, true)).toBe('advance');
  });
});

/* ------------------------------------------------------------------ engine */

interface Deferred {
  resolve(): void;
  reject(err: unknown): void;
}

/** Minimal HTMLAudioElement stand-in: events + the fields the engine reads. */
class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  src = '';
  currentSrc = '';
  volume = 1;
  muted = false;
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 200;
  readyState = 0;
  networkState = 0;
  playbackRate = 1;
  preload = '';
  crossOrigin: string | null = null;
  error: { code: number } | null = null;
  loads = 0;
  plays: Deferred[] = [];

  constructor() {
    super();
    FakeAudio.instances.push(this);
  }
  load(): void {
    this.loads += 1;
    this.currentSrc = this.src;
    this.error = null;
    this.networkState = 2;
  }
  play(): Promise<void> {
    this.paused = false;
    return new Promise<void>((resolve, reject) => {
      this.plays.push({ resolve, reject });
    });
  }
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  removeAttribute(): void {
    this.src = '';
  }
  emit(type: string): void {
    this.dispatchEvent(new Event(type));
  }
  /** Simulate the element giving up on its current source. */
  fail(): void {
    this.error = { code: 4 };
    this.networkState = 3;
    this.paused = true;
    this.emit('error');
  }
}

(globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;

const { audioEngine } = await import('./engine');
type Callbacks = Parameters<typeof audioEngine.init>[0];

function callbacks(): { [K in keyof Required<Callbacks>]: ReturnType<typeof vi.fn> } {
  return {
    onTime: vi.fn(),
    onPlayState: vi.fn(),
    onBuffering: vi.fn(),
    onEnded: vi.fn(),
    onFatalError: vi.fn(),
    onSource: vi.fn(),
    onBlocked: vi.fn(),
  };
}

const track = (id: string, urls: string[]): Song =>
  ({ id, audio: urls.map((url, i) => ({ quality: `${320 - i * 100}kbps`, url })) } as unknown as Song);

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

/** Fresh engine element + callbacks per test. */
function boot(): { el: FakeAudio; cb: ReturnType<typeof callbacks> } {
  audioEngine.destroy();
  FakeAudio.instances = [];
  const cb = callbacks();
  audioEngine.init(cb as unknown as Callbacks);
  audioEngine.setVolume(1); // the singleton remembers the last test's target
  return { el: FakeAudio.instances[0], cb };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('AudioEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });
  afterEach(() => {
    audioEngine.destroy();
    setHidden(false);
    vi.useRealTimers();
  });

  describe('cancelled fades leave no visibility listener behind', () => {
    it('a cancelled sleep fade does not pause on the next backgrounding', () => {
      const { el } = boot();
      audioEngine.load(track('a', ['u1']), 'high', true);
      const done = vi.fn();
      audioEngine.fadeOutAndPause(8000, done);
      vi.advanceTimersByTime(200);
      audioEngine.setVolume(0.8); // cancels the fade
      setHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(done).not.toHaveBeenCalled();
      expect(el.volume).toBe(0.8);
      expect(el.paused).toBe(false);
    });

    it('a cancelled crossfade tail does not zero the volume later', () => {
      const { el } = boot();
      audioEngine.load(track('a', ['u1']), 'high', true);
      audioEngine.fadeOut(1200);
      vi.advanceTimersByTime(200);
      audioEngine.setVolume(0.8);
      setHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(el.volume).toBe(0.8);
    });

    it('a fade that ran to completion is inert afterwards too', () => {
      const { el } = boot();
      audioEngine.load(track('a', ['u1']), 'high', true);
      const done = vi.fn();
      audioEngine.fadeOutAndPause(1000, done);
      vi.advanceTimersByTime(1100);
      expect(done).toHaveBeenCalledTimes(1);
      setHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(done).toHaveBeenCalledTimes(1);
      expect(el.volume).toBe(1); // restored to the target for the next play
    });
  });

  describe('wantAutoplay follows play() / pause()', () => {
    it('a recovery reload after pause() does not restart playback', () => {
      const { el } = boot();
      audioEngine.load(track('a', ['u1', 'u2']), 'high', true);
      expect(el.plays).toHaveLength(1);
      audioEngine.pause();
      el.fail(); // never played → advance to u2
      expect(el.src).toBe('u2');
      expect(el.plays).toHaveLength(1);
    });

    it('a recovery reload after play() resumes playback', () => {
      const { el } = boot();
      audioEngine.load(track('a', ['u1', 'u2']), 'high', false);
      expect(el.plays).toHaveLength(0);
      audioEngine.play();
      expect(el.plays).toHaveLength(1);
      el.fail();
      expect(el.src).toBe('u2');
      expect(el.plays).toHaveLength(2);
    });

    it('a finished sleep fade leaves recovery paused', () => {
      const { el } = boot();
      audioEngine.load(track('a', ['u1', 'u2']), 'high', true);
      audioEngine.fadeOutAndPause(1000, () => undefined);
      vi.advanceTimersByTime(1100);
      expect(el.paused).toBe(true);
      el.fail();
      expect(el.src).toBe('u2');
      expect(el.plays).toHaveLength(1);
    });
  });

  it('play() after every source failed starts over at the last position', () => {
    const { el, cb } = boot();
    audioEngine.load(track('a', ['u1', 'u2']), 'high', true);
    el.currentTime = 42;
    el.emit('timeupdate');
    el.fail(); // u1 had played → one same-source retry
    el.fail(); // retry spent → u2
    el.fail(); // u2 never played → fatal
    expect(cb.onFatalError).toHaveBeenCalledWith('a');
    const playsBefore = el.plays.length;
    const loadsBefore = el.loads;
    audioEngine.play();
    expect(el.src).toBe('u1');
    expect(el.loads).toBe(loadsBefore + 1);
    expect(el.plays).toHaveLength(playsBefore + 1);
    el.currentTime = 0;
    el.emit('loadeddata');
    expect(el.currentTime).toBe(42);
  });

  describe('lastInterruptionAt', () => {
    const interrupt = (el: FakeAudio): void => {
      el.currentTime = 10;
      vi.advanceTimersByTime(5000); // well past the intentional-pause window
      el.pause(); // the OS paused us — not engine.pause()
    };

    it('is set by an unrequested pause and cleared by play()', () => {
      const { el } = boot();
      audioEngine.load(track('a', ['u1']), 'high', true);
      interrupt(el);
      expect(audioEngine.lastInterruptionAt).toBeGreaterThan(0);
      audioEngine.play();
      expect(audioEngine.lastInterruptionAt).toBe(0);
    });

    it('is cleared by a deliberate pause()', () => {
      const { el } = boot();
      audioEngine.load(track('a', ['u1']), 'high', true);
      interrupt(el);
      audioEngine.pause();
      expect(audioEngine.lastInterruptionAt).toBe(0);
    });

    it('is cleared by load()', () => {
      const { el } = boot();
      audioEngine.load(track('a', ['u1']), 'high', true);
      interrupt(el);
      audioEngine.load(track('b', ['u3']), 'high', false);
      expect(audioEngine.lastInterruptionAt).toBe(0);
    });
  });

  describe('stale play() promises', () => {
    it('ignores a rejection from a superseded load', async () => {
      const { el, cb } = boot();
      audioEngine.load(track('a', ['u1']), 'high', true);
      audioEngine.load(track('b', ['u2']), 'high', true);
      cb.onPlayState.mockClear();
      cb.onBlocked.mockClear();
      el.plays[0].reject(new DOMException('blocked', 'NotAllowedError'));
      await flush();
      expect(cb.onPlayState).not.toHaveBeenCalled();
      expect(cb.onBlocked).not.toHaveBeenCalled();
    });

    it('ignores AbortError from the current load and from play()', async () => {
      const { el, cb } = boot();
      audioEngine.load(track('a', ['u1']), 'high', true);
      audioEngine.play();
      cb.onPlayState.mockClear();
      el.plays[0].reject(new DOMException('interrupted', 'AbortError'));
      el.plays[1].reject(new DOMException('interrupted', 'AbortError'));
      await flush();
      expect(cb.onPlayState).not.toHaveBeenCalled();
    });

    it('still reports a genuine autoplay block', async () => {
      const { el, cb } = boot();
      audioEngine.load(track('a', ['u1']), 'high', true);
      el.plays[0].reject(new DOMException('blocked', 'NotAllowedError'));
      await flush();
      expect(cb.onPlayState).toHaveBeenCalledWith(false);
      expect(cb.onBlocked).toHaveBeenCalledTimes(1);
    });
  });

  describe('position survives a second recovery hop', () => {
    it('keeps lastTime while a recovery seek is pending', () => {
      const { el } = boot();
      audioEngine.load(track('a', ['u1', 'u2', 'u3']), 'high', true);
      el.currentTime = 60;
      el.emit('timeupdate');
      el.fail(); // same-source retry, pendingSeek = 60
      el.currentTime = 0;
      el.emit('timeupdate'); // fresh load reports 0:00 before the seek lands
      el.fail(); // second hop → u2
      expect(el.src).toBe('u2');
      el.emit('loadeddata');
      expect(el.currentTime).toBe(60);
    });

    it('reloadWithSources resumes at the last position', () => {
      const { el } = boot();
      audioEngine.load(track('a', ['u1']), 'high', true);
      el.currentTime = 75;
      el.emit('timeupdate');
      expect(audioEngine.reloadWithSources(['fresh'])).toBe(true);
      el.currentTime = 0;
      el.emit('loadeddata');
      expect(el.src).toBe('fresh');
      expect(el.currentTime).toBe(75);
    });
  });
});
