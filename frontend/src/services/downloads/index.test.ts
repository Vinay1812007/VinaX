import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

interface FileArgs {
  path: string;
  directory: string;
}

const h = vi.hoisted(() => ({
  items: {} as Record<string, { path?: string }>,
  downloading: [] as Array<[string, boolean]>,
  added: [] as Array<{ id: string; dir?: string }>,
  downloadFile: vi.fn<(o: FileArgs & { url: string }) => Promise<void>>(),
  deleteFile: vi.fn<(o: FileArgs) => Promise<void>>(),
  httpGet: vi.fn<() => Promise<{ status: number; data: unknown }>>(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { External: 'EXTERNAL', Data: 'DATA' },
  Filesystem: {
    downloadFile: h.downloadFile,
    deleteFile: h.deleteFile,
    writeFile: () => Promise.resolve(),
    stat: () => Promise.resolve({ size: 5_000_000 }),
    getUri: ({ path }: FileArgs) => Promise.resolve({ uri: `file:///${path}` }),
    readFile: () => Promise.reject(new Error('unused')),
  },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (uri: string) => `bridge:${uri}` },
  CapacitorHttp: { get: h.httpGet },
}));
vi.mock('@/services/native', () => ({ isNativePlatform: () => true }));
vi.mock('@/services/analytics/telemetry', () => ({ reportError: () => undefined, trackDownload: () => undefined }));
vi.mock('@/store/downloadsStore', () => ({
  useDownloadsStore: {
    getState: () => ({
      items: h.items,
      setDownloading: (id: string, v: boolean) => h.downloading.push([id, v]),
      add: (song: Song, path?: string, _uri?: string, dir?: string) => {
        h.items[song.id] = { path };
        h.added.push({ id: song.id, dir });
      },
    }),
  },
}));

const { downloadSong } = await import('./index');

const song = (id: string): Song =>
  ({ id, title: `Song ${id}`, audio: [{ quality: '320kbps', url: `https://cdn.test/${id}_320.mp4` }] } as unknown as Song);

beforeEach(() => {
  h.items = {};
  h.downloading = [];
  h.added = [];
  h.downloadFile.mockReset();
  h.deleteFile.mockReset().mockResolvedValue(undefined);
  h.httpGet.mockReset().mockResolvedValue({ status: 500, data: null });
});

describe('downloadSong', () => {
  it('concurrent calls for one song share a single download', async () => {
    let finish: () => void = () => undefined;
    h.downloadFile.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = downloadSong(song('a'));
    const second = downloadSong(song('a'));
    await vi.waitFor(() => expect(h.downloadFile).toHaveBeenCalledTimes(1));
    finish();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(h.downloadFile).toHaveBeenCalledTimes(1);
    expect(h.added).toEqual([{ id: 'a', dir: 'EXTERNAL' }]);
    expect(h.downloading).toEqual([['a', true], ['a', false]]);
  });

  it('different songs download independently, even while one is in flight', async () => {
    const finish: Array<() => void> = [];
    h.downloadFile.mockImplementation(() => new Promise<void>((resolve) => { finish.push(resolve); }));
    const b = downloadSong(song('b'));
    await vi.waitFor(() => expect(h.downloadFile).toHaveBeenCalledTimes(1));
    const c = downloadSong(song('c'));
    await vi.waitFor(() => expect(h.downloadFile).toHaveBeenCalledTimes(2));
    finish.forEach((done) => done());
    expect(await Promise.all([b, c])).toEqual([true, true]);
    expect(h.added.map((a) => a.id).sort()).toEqual(['b', 'c']);
  });

  it('a finished attempt does not block a retry', async () => {
    h.downloadFile.mockRejectedValue(new Error('disk full'));
    expect(await downloadSong(song('d'))).toBe(false);
    h.downloadFile.mockReset().mockResolvedValue(undefined);
    expect(await downloadSong(song('d'))).toBe(true);
  });

  it('removes the partial device-storage file before falling back to app data', async () => {
    const order: string[] = [];
    h.downloadFile.mockImplementation(({ directory }) => {
      order.push(`download:${directory}`);
      return directory === 'EXTERNAL' ? Promise.reject(new Error('no external storage')) : Promise.resolve();
    });
    h.deleteFile.mockImplementation(({ directory }) => {
      order.push(`delete:${directory}`);
      return Promise.reject(new Error('nothing to delete')); // best-effort: must not abort the fallback
    });
    expect(await downloadSong(song('e'))).toBe(true);
    expect(order).toEqual(['download:EXTERNAL', 'delete:EXTERNAL', 'download:DATA']);
    expect(h.deleteFile).toHaveBeenCalledWith({ path: 'vinax-downloads/e.mp4', directory: 'EXTERNAL' });
    expect(h.added).toEqual([{ id: 'e', dir: 'DATA' }]);
  });
});
