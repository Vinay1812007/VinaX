// @vitest-environment jsdom
/**
 * Casting, both senders: the shared store logic (session handoff, the silent
 * local clock following the receiver, the player's intercepts) driven through
 * the Android app's VinaxCast plugin (mocked) and through a stand-in of the
 * Cast web SDK; and the one MediaInfo builder both use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

const native = vi.hoisted(() => ({ on: true }));
const plugins = vi.hoisted(() => ({ available: true }));
const player = vi.hoisted(() => {
  let s: Record<string, unknown> = {};
  return {
    getState: () => s,
    setState: (p: Record<string, unknown>) => {
      s = { ...s, ...p };
    },
    reset: (v: Record<string, unknown>) => {
      s = v;
    },
  };
});
const engine = vi.hoisted(() => ({
  setVolume: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  position: vi.fn<() => number | null>(() => 0),
}));

vi.mock('@/services/native', () => ({ isNativePlatform: () => native.on }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: () => plugins.available, isNativePlatform: () => native.on },
  registerPlugin: vi.fn(),
}));
vi.mock('@/store/playerStore', () => ({ usePlayerStore: player }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ audioQuality: 'auto' }) } }));
vi.mock('@/services/audio/engine', () => ({
  audioEngine: engine,
  orderedSources: (song: Song) => (song.audio ?? []).map((a) => a.url),
}));

const song = (id: string, audio = [`https://cdn.example/${id}_320.mp4`]): Song =>
  ({
    id,
    title: `Song ${id}`,
    subtitle: 'Artist',
    images: [{ quality: '500x500', url: `https://img.example/${id}.jpg` }],
    audio: audio.map((url) => ({ quality: '320kbps', url })),
  }) as unknown as Song;

type Fn = (e: unknown) => void;

function fakePlugin(info = { available: true, devices: true, connected: false } as Record<string, unknown>) {
  const listeners: Record<string, Fn> = {};
  return {
    listeners,
    emit: (event: string, e: unknown) => listeners[event]?.(e),
    init: vi.fn(async () => info),
    showDevicePicker: vi.fn(async () => undefined),
    loadMedia: vi.fn(async () => undefined),
    play: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    seek: vi.fn(async () => undefined),
    setVolume: vi.fn(async () => undefined),
    endSession: vi.fn(async () => undefined),
    addListener: vi.fn(async (event: string, fn: Fn) => {
      listeners[event] = fn;
      return { remove: async () => undefined };
    }),
  };
}

async function load() {
  const cast = await import('./index');
  const nat = await import('./native');
  return { cast, nat };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
  native.on = true;
  plugins.available = true;
  for (const f of Object.values(engine)) f.mockClear();
  engine.position.mockReturnValue(0);
  player.reset({ queue: [song('a'), song('b')], index: 0, isPlaying: true, currentTime: 42, volume: 0.8 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('castMediaFor (one builder for the web SDK and the Android plugin)', () => {
  it('sends the first stream a TV can fetch, its type, and network artwork only', async () => {
    const { castMediaFor, castMime } = await import('./media');
    expect(castMediaFor(song('a', ['blob:local', 'https://cdn.example/a_160.mp3']), 'auto')).toEqual({
      url: 'https://cdn.example/a_160.mp3',
      contentType: 'audio/mpeg',
      title: 'Song a',
      artist: 'Artist',
      image: 'https://img.example/a.jpg',
    });
    expect(castMediaFor(song('a', ['blob:local']), 'auto')).toBeNull();
    const noArt = { ...song('a'), images: [] } as unknown as Song;
    expect(castMediaFor(noArt, 'auto')?.image).toBe('');
    expect(castMime('https://x/y.m4a?t=1')).toBe('audio/mp4');
    expect(castMime('https://x/y.flac')).toBe('audio/flac');
  });
});

describe('Android app: the VinaxCast plugin', () => {
  it('does nothing in an app built before the plugin', async () => {
    plugins.available = false;
    const { cast, nat } = await load();
    await nat.startNativeCast();
    expect(cast.useCastStore.getState().available).toBe(false);
    expect(cast.castRequestSession()).toBe(false);
  });

  it('stays hidden when the phone cannot cast (no Google Play services)', async () => {
    const { cast, nat } = await load();
    const p = fakePlugin({ available: false, devices: false, connected: false });
    await nat.startNativeCast(p as never);
    expect(cast.useCastStore.getState()).toMatchObject({ available: false, native: false });
  });

  it('starts once, then opens the phone’s device list and tracks nearby TVs', async () => {
    const { cast, nat } = await load();
    const p = fakePlugin();
    await Promise.all([nat.startNativeCast(p as never), nat.startNativeCast(p as never)]);
    expect(p.init).toHaveBeenCalledTimes(1);
    expect(cast.useCastStore.getState()).toMatchObject({ available: true, native: true, nearby: true, connected: false });
    expect(cast.castRequestSession()).toBe(true);
    expect(p.showDevicePicker).toHaveBeenCalledTimes(1);
    p.emit('availability', { devices: false });
    expect(cast.useCastStore.getState().nearby).toBe(false);
  });

  it('hands the current song over where it is, with the phone muted first', async () => {
    const { cast, nat } = await load();
    const p = fakePlugin();
    await nat.startNativeCast(p as never);
    p.emit('session', { connected: true, deviceName: 'Living Room TV' });
    expect(cast.useCastStore.getState()).toMatchObject({ connected: true, deviceName: 'Living Room TV' });
    expect(engine.setVolume).toHaveBeenLastCalledWith(0);
    expect(p.loadMedia).toHaveBeenCalledWith({
      url: 'https://cdn.example/a_320.mp4',
      contentType: 'audio/mp4',
      title: 'Song a',
      artist: 'Artist',
      image: 'https://img.example/a.jpg',
      autoplay: true,
      startTime: 42,
    });
  });

  it('gives the phone its sound back when the handoff fails', async () => {
    const { nat } = await load();
    const p = fakePlugin();
    p.loadMedia.mockRejectedValueOnce(new Error('Cast load failed'));
    await nat.startNativeCast(p as never);
    p.emit('session', { connected: true, deviceName: 'TV' });
    await vi.waitFor(() => expect(engine.setVolume).toHaveBeenLastCalledWith(0.8));
  });

  it('picks up a session the TV kept from last time', async () => {
    const { cast, nat } = await load();
    const p = fakePlugin({ available: true, devices: true, connected: true, deviceName: 'Bedroom' });
    await nat.startNativeCast(p as never);
    expect(cast.useCastStore.getState()).toMatchObject({ connected: true, deviceName: 'Bedroom' });
    expect(p.loadMedia).toHaveBeenCalledTimes(1);
  });

  it('routes play, pause, seek, volume and the next song to the TV', async () => {
    const { cast, nat } = await load();
    const p = fakePlugin();
    await nat.startNativeCast(p as never);
    expect(cast.castInterceptPlayPause(false)).toBe(false); // not casting yet
    p.emit('session', { connected: true, deviceName: 'TV' });
    expect(cast.castInterceptPlayPause(false)).toBe(true);
    expect(p.pause).toHaveBeenCalledTimes(1);
    expect(cast.castInterceptPlayPause(true)).toBe(true);
    expect(p.play).toHaveBeenCalledTimes(1);
    expect(cast.castInterceptSeek(90)).toBe(true);
    expect(p.seek).toHaveBeenCalledWith({ position: 90 });
    expect(cast.castInterceptVolume(1.4)).toBe(true);
    expect(p.setVolume).toHaveBeenCalledWith({ level: 1 });
    cast.castLoadSong(song('b'), true);
    expect(p.loadMedia).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://cdn.example/b_320.mp4', autoplay: true, startTime: 0 }));
  });

  it('a pause or seek on the TV moves the phone’s silent clock, so it never skips ahead', async () => {
    const { nat } = await load();
    const p = fakePlugin();
    await nat.startNativeCast(p as never);
    p.emit('session', { connected: true, deviceName: 'TV' });
    const url = 'https://cdn.example/a_320.mp4';
    // Reports straight after the load may be about the old state: ignored.
    p.emit('status', { state: 'paused', position: 42, duration: 200, url });
    expect(engine.pause).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);
    engine.position.mockReturnValue(43);
    p.emit('status', { state: 'playing', position: 43, duration: 200, url });
    expect(engine.play).not.toHaveBeenCalled(); // already playing here
    expect(engine.seek).not.toHaveBeenCalled(); // in step
    expect(player.getState().currentTime).toBe(43);

    p.emit('status', { state: 'paused', position: 44, duration: 200, url });
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(player.getState().isPlaying).toBe(false);
    p.emit('status', { state: 'paused', position: 44, duration: 200, url });
    expect(engine.pause).toHaveBeenCalledTimes(1); // only a change is acted on

    p.emit('status', { state: 'playing', position: 150, duration: 200, url });
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(player.getState().isPlaying).toBe(true);
    expect(engine.seek).toHaveBeenCalledWith(150);
  });

  it('ignores reports about a song it was not sent', async () => {
    const { nat } = await load();
    const p = fakePlugin();
    await nat.startNativeCast(p as never);
    p.emit('session', { connected: true, deviceName: 'TV' });
    vi.advanceTimersByTime(3000);
    p.emit('status', { state: 'paused', position: 180, duration: 200, url: 'https://cdn.example/old.mp4' });
    p.emit('status', { state: 'paused', position: 180, duration: 200 });
    expect(engine.pause).not.toHaveBeenCalled();
    expect(engine.seek).not.toHaveBeenCalled();
    expect(player.getState().currentTime).toBe(42);
  });

  it('stopping the cast brings the phone’s sound back', async () => {
    const { cast, nat } = await load();
    const p = fakePlugin();
    await nat.startNativeCast(p as never);
    p.emit('session', { connected: true, deviceName: 'TV' });
    p.emit('session', { connected: false });
    expect(cast.useCastStore.getState()).toMatchObject({ connected: false, deviceName: null });
    expect(engine.setVolume).toHaveBeenLastCalledWith(0.8);
    expect(cast.castInterceptPlayPause(true)).toBe(false);
  });

  it('loads only when the device sheet opens, then through the registered plugin', async () => {
    const core = await import('@capacitor/core');
    const p = fakePlugin();
    vi.mocked(core.registerPlugin).mockReturnValue(p as never);
    const { cast } = await load();
    expect(p.init).not.toHaveBeenCalled();
    cast.ensureCastSdk();
    cast.ensureCastSdk();
    await vi.waitFor(() => expect(cast.useCastStore.getState().native).toBe(true));
    expect(p.init).toHaveBeenCalledTimes(1);
    expect(document.querySelector('script[src*="cast_sender.js"]')).toBeNull(); // no web SDK in the app
  });
});

describe('website: the Cast web SDK', () => {
  function fakeSdk() {
    const ctxListeners: Fn[] = [];
    const playerListeners: Record<string, () => void> = {};
    const remote = { isPaused: false, isMediaLoaded: true, currentTime: 0, volumeLevel: 1, mediaInfo: { contentId: '' } };
    const controller = { playOrPause: vi.fn(), seek: vi.fn(), setVolumeLevel: vi.fn(), addEventListener: (t: string, fn: () => void) => (playerListeners[t] = fn) };
    const session = { loadMedia: vi.fn<(req: unknown) => Promise<void>>(async () => undefined), getCastDevice: () => ({ friendlyName: 'Chromecast' }) };
    const context = {
      setOptions: vi.fn(),
      requestSession: vi.fn(async () => undefined),
      getCurrentSession: () => session,
      addEventListener: (_t: string, fn: Fn) => ctxListeners.push(fn),
    };
    class MediaInfo {
      metadata: Record<string, unknown> = {};
      constructor(public contentId: string, public contentType: string) {}
    }
    class LoadRequest {
      autoplay = false;
      currentTime = 0;
      constructor(public media: MediaInfo) {}
    }
    const w = window as unknown as Record<string, unknown>;
    w.chrome = { cast: { AutoJoinPolicy: { ORIGIN_SCOPED: 'origin' }, media: { DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845', MediaInfo, LoadRequest, MusicTrackMediaMetadata: class {} } } };
    w.cast = {
      framework: {
        CastContext: { getInstance: () => context },
        RemotePlayer: function RemotePlayer() { return remote; },
        RemotePlayerController: function RemotePlayerController() { return controller; },
        CastContextEventType: { SESSION_STATE_CHANGED: 'state' },
        SessionState: { SESSION_STARTED: 'started', SESSION_RESUMED: 'resumed', SESSION_ENDED: 'ended' },
        RemotePlayerEventType: { CURRENT_TIME_CHANGED: 'time', IS_PAUSED_CHANGED: 'paused' },
      },
    };
    return { ctxListeners, playerListeners, remote, controller, session, context };
  }

  afterEach(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.cast;
    delete w.chrome;
  });

  it('uses the same receiver, MediaInfo and clock rules as the app', async () => {
    native.on = false;
    const sdk = fakeSdk();
    const { cast } = await load();
    expect(cast.useCastStore.getState().available).toBe(false); // nothing until the device sheet opens
    cast.ensureCastSdk();
    await vi.waitFor(() => expect(cast.useCastStore.getState().available).toBe(true));
    expect(document.querySelector('script[src*="cast_sender.js"]')).not.toBeNull();
    expect(sdk.context.setOptions).toHaveBeenCalledWith(expect.objectContaining({ receiverApplicationId: 'CC1AD845' }));
    expect(cast.useCastStore.getState()).toMatchObject({ available: true, native: false });

    sdk.ctxListeners[0]({ sessionState: 'started' });
    expect(cast.useCastStore.getState()).toMatchObject({ connected: true, deviceName: 'Chromecast' });
    const req = sdk.session.loadMedia.mock.calls[0][0] as unknown as { autoplay: boolean; currentTime: number; media: { contentId: string; contentType: string; metadata: Record<string, unknown> } };
    expect(req).toMatchObject({ autoplay: true, currentTime: 42 });
    expect(req.media).toMatchObject({ contentId: 'https://cdn.example/a_320.mp4', contentType: 'audio/mp4' });
    expect(req.media.metadata).toMatchObject({ title: 'Song a', artist: 'Artist', images: [{ url: 'https://img.example/a.jpg' }] });

    // Play/pause asks for a state: the SDK only toggles when the TV is not there yet.
    cast.castInterceptPlayPause(true);
    expect(sdk.controller.playOrPause).not.toHaveBeenCalled();
    cast.castInterceptPlayPause(false);
    expect(sdk.controller.playOrPause).toHaveBeenCalledTimes(1);

    // A pause from the TV's remote pauses the phone's clock too.
    vi.advanceTimersByTime(3000);
    sdk.remote.mediaInfo.contentId = 'https://cdn.example/a_320.mp4';
    sdk.remote.isPaused = false;
    sdk.playerListeners.paused();
    sdk.remote.isPaused = true;
    sdk.playerListeners.paused();
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(player.getState().isPlaying).toBe(false);

    sdk.ctxListeners[0]({ sessionState: 'ended' });
    expect(cast.useCastStore.getState().connected).toBe(false);
    expect(engine.setVolume).toHaveBeenLastCalledWith(0.8);
  });
});
