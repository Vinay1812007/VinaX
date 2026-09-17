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
  pending: new Map<string, (dataUri: string | null) => void>(),
}));

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({ setMetadata: h.setMetadata }),
  Capacitor: { getPlatform: () => 'android', isPluginAvailable: () => true },
}));
vi.mock('@/services/native', () => ({ isNativePlatform: () => true }));
vi.mock('@/utils/images', () => ({ bestImage: (images: string) => images }));
vi.mock('@/utils/artwork', () => ({
  artworkDataUrl: (url: string) => new Promise<string | null>((resolve) => h.pending.set(url, resolve)),
}));

const { updateMediaMetadata } = await import('./index');

const song = (id: string): Song =>
  ({ id, title: `Title ${id}`, subtitle: `Artist ${id}`, images: `cover-${id}`, album: { name: `Album ${id}` } } as unknown as Song);

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('updateMediaMetadata (native) — late artwork', () => {
  beforeEach(() => {
    h.setMetadata.mockClear();
    h.pending.clear();
  });

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
});
