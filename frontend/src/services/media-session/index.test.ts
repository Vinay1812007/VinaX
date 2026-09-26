import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

interface Metadata {
  title: string;
  artist: string;
  album: string;
  artwork: string;
}

const h = vi.hoisted(() => ({
  setMetadata: vi.fn<(m: Metadata) => Promise<void>>(() => Promise.resolve()),
  setPlaybackState: vi.fn<(o: { playbackState: string }) => Promise<void>>(() => Promise.resolve()),
  setPosition: vi.fn<(o: { duration: number; position: number; playbackRate: number }) => Promise<void>>(() => Promise.resolve()),
  stop: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  listeners: new Map<string, (d: unknown) => void>(),
  pending: new Map<string, (dataUri: string | null) => void>(),
}));

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    setMetadata: h.setMetadata,
    setPlaybackState: h.setPlaybackState,
    setPosition: h.setPosition,
    stop: h.stop,
    addListener: (event: string, cb: (d: unknown) => void) => {
      h.listeners.set(event, cb);
      return Promise.resolve({ remove: () => h.listeners.delete(event) });
    },
  }),
  Capacitor: { getPlatform: () => 'android', isPluginAvailable: () => true },
}));
vi.mock('@/services/native', () => ({ isNativePlatform: () => true }));
vi.mock('@/utils/images', () => ({ bestImage: (images: string) => images }));
vi.mock('@/utils/artwork', () => ({
  artworkDataUrl: (url: string) => new Promise<string | null>((resolve) => h.pending.set(url, resolve)),
}));

const { updateMediaMetadata, updatePlaybackState, updatePositionState, setMediaHandlers } = await import('./index');

const song = (id: string): Song =>
  ({ id, title: `Title ${id}`, subtitle: `Artist ${id}`, images: `cover-${id}`, album: { name: `Album ${id}` } } as unknown as Song);

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const reset = (): void => {
  h.setMetadata.mockClear();
  h.setPlaybackState.mockClear();
  h.setPosition.mockClear();
  h.stop.mockClear();
  h.pending.clear();
};

describe('updateMediaMetadata (native) — late artwork', () => {
  beforeEach(reset);

  it("never pushes song A's cover under song B's title", async () => {
    updateMediaMetadata(song('a'));
    updateMediaMetadata(song('b'));
    h.setMetadata.mockClear();

    h.pending.get('cover-a')?.('data:a'); // A's decode lands after B took over
    await flush();
    expect(h.setMetadata).not.toHaveBeenCalled();

    h.pending.get('cover-b')?.('data:b');
    await flush();
    expect(h.setMetadata).toHaveBeenCalledTimes(1);
    expect(h.setMetadata).toHaveBeenLastCalledWith({ title: 'Title b', artist: 'Artist b', album: 'Album b', artwork: 'data:b' });
  });

  it('shows the title at once and fills the cover in when it is still current', async () => {
    updateMediaMetadata(song('c'));
    expect(h.setMetadata).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Title c', artwork: '' }));
    h.pending.get('cover-c')?.('data:c');
    await flush();
    expect(h.setMetadata).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Title c', artwork: 'data:c' }));
  });

  it('drops a late cover once the session was cleared', async () => {
    updateMediaMetadata(song('d'));
    updateMediaMetadata(null);
    h.setMetadata.mockClear();
    h.pending.get('cover-d')?.('data:d');
    await flush();
    expect(h.setMetadata).not.toHaveBeenCalled();
  });

  it('clearing the track ends the native session (which clears the widget)', () => {
    updateMediaMetadata(song('e'));
    expect(h.stop).not.toHaveBeenCalled();
    updateMediaMetadata(null);
    expect(h.stop).toHaveBeenCalledTimes(1);
  });
});

describe('native state and position pushes', () => {
  beforeEach(reset);

  it('a state flip re-sends the last position and opens the 1 s gate', () => {
    updateMediaMetadata(song('f'));
    updatePositionState(200, 10, 1);
    expect(h.setPosition).toHaveBeenCalledTimes(1);
    updatePositionState(200, 10.4, 1); // inside the gate: skipped
    expect(h.setPosition).toHaveBeenCalledTimes(1);

    updatePlaybackState(false);
    expect(h.setPlaybackState).toHaveBeenLastCalledWith({ playbackState: 'paused' });
    expect(h.setPosition).toHaveBeenCalledTimes(2);
    expect(h.setPosition).toHaveBeenLastCalledWith({ duration: 200, position: 10.4, playbackRate: 1 });

    updatePositionState(200, 10.5, 1); // the gate was reset by the flip
    expect(h.setPosition).toHaveBeenCalledTimes(3);
  });

  it('a new track lets its first tick through even when the position barely moved', () => {
    updateMediaMetadata(song('g'));
    updatePositionState(180, 0.2, 1);
    expect(h.setPosition).toHaveBeenCalledTimes(1);
    updateMediaMetadata(song('h'));
    updatePositionState(240, 0.3, 1);
    expect(h.setPosition).toHaveBeenCalledTimes(2);
    expect(h.setPosition).toHaveBeenLastCalledWith({ duration: 240, position: 0.3, playbackRate: 1 });
  });

  it('a native resync replays metadata, state and position', async () => {
    await setMediaHandlers({ play: vi.fn(), pause: vi.fn(), next: vi.fn(), prev: vi.fn(), seekTo: vi.fn(), seekBy: vi.fn() });
    updateMediaMetadata(song('i'));
    updatePlaybackState(true);
    updatePositionState(300, 42, 1);
    reset();

    h.listeners.get('action')?.({ action: 'resync' });
    expect(h.setMetadata).toHaveBeenCalledTimes(1);
    expect(h.setMetadata).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Title i' }));
    expect(h.setPlaybackState).toHaveBeenLastCalledWith({ playbackState: 'playing' });
    expect(h.setPosition).toHaveBeenLastCalledWith({ duration: 300, position: 42, playbackRate: 1 });
  });
});
