import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

interface FileArgs {
  path: string;
  directory: string;
}
interface DownloadArgs extends FileArgs {
  url: string;
  connectTimeout?: number;
  readTimeout?: number;
}
interface ReadArgs extends FileArgs {
  offset?: number;
  length?: number;
}

const h = vi.hoisted(() => ({
  items: {} as Record<string, { path?: string; uri?: string; dir?: string }>,
  downloading: [] as Array<[string, boolean]>,
  added: [] as Array<{ id: string; dir?: string }>,
  errors: [] as string[],
  downloadFile: vi.fn<(o: DownloadArgs) => Promise<void>>(),
  deleteFile: vi.fn<(o: FileArgs) => Promise<void>>(),
  mkdir: vi.fn<(o: FileArgs & { recursive?: boolean }) => Promise<void>>(),
  readFile: vi.fn<(o: ReadArgs) => Promise<{ data: string | Blob }>>(),
  stat: vi.fn<(o: FileArgs) => Promise<{ size: number }>>(),
  httpGet: vi.fn<() => Promise<{ status: number; data: unknown }>>(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { External: 'EXTERNAL', Data: 'DATA' },
  Filesystem: {
    downloadFile: h.downloadFile,
    deleteFile: h.deleteFile,
    mkdir: h.mkdir,
    writeFile: () => Promise.resolve(),
    stat: h.stat,
    getUri: ({ path }: FileArgs) => Promise.resolve({ uri: `file:///${path}` }),
    readFile: h.readFile,
  },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (uri: string) => `bridge:${uri}` },
  CapacitorHttp: { get: h.httpGet },
}));
vi.mock('@/services/native', () => ({ isNativePlatform: () => true }));
vi.mock('@/services/analytics/telemetry', () => ({
  reportError: (_kind: string, msg: string) => h.errors.push(msg),
  trackDownload: () => undefined,
}));
vi.mock('@/store/downloadsStore', () => ({
  useDownloadsStore: {
    getState: () => ({
      items: h.items,
      setDownloading: (id: string, v: boolean) => h.downloading.push([id, v]),
      add: (song: Song, path?: string, uri?: string, dir?: string) => {
        h.items[song.id] = { path, uri, dir };
        h.added.push({ id: song.id, dir });
      },
      setUri: () => undefined,
      remove: (id: string) => delete h.items[id],
    }),
  },
}));

const {
  downloadSong,
  downloadMany,
  downloadUrls,
  classifyDownloadError,
  downloadFailureMessage,
  lastDownloadFailure,
  getOfflineSources,
  getOfflineUrl,
  removeDownload,
} = await import('./index');

const LADDER = ['320kbps', '160kbps', '96kbps', '48kbps'];
const song = (id: string): Song =>
  ({
    id,
    title: `Song ${id}`,
    audio: LADDER.map((q) => ({ quality: q, url: `https://cdn.test/${id}_${q}.mp4` })),
  }) as unknown as Song;

/** How the Android downloader reports an HTTP 404 (FileNotFoundException(url)). */
const notFound = (url: string) => new Error(`Error downloading file: ${url}`);

beforeEach(() => {
  h.items = {};
  h.downloading = [];
  h.added = [];
  h.errors = [];
  h.downloadFile.mockReset().mockResolvedValue(undefined);
  h.deleteFile.mockReset().mockResolvedValue(undefined);
  h.mkdir.mockReset().mockResolvedValue(undefined);
  h.readFile.mockReset().mockRejectedValue(new Error('unused'));
  h.stat.mockReset().mockResolvedValue({ size: 5_000_000 });
  h.httpGet.mockReset().mockResolvedValue({ status: 500, data: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
    expect(h.added).toEqual([{ id: 'a', dir: 'DATA' }]);
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
    h.downloadFile.mockRejectedValue(new Error('No space left on device'));
    expect(await downloadSong(song('d'))).toBe(false);
    expect(lastDownloadFailure('d')).toBe('storage');
    h.downloadFile.mockReset().mockResolvedValue(undefined);
    expect(await downloadSong(song('d'))).toBe(true);
    expect(lastDownloadFailure('d')).toBeNull();
  });

  it('creates the download folder before the native download (it will not)', async () => {
    const order: string[] = [];
    h.mkdir.mockImplementation(({ path, directory, recursive }) => {
      order.push(`mkdir:${directory}:${path}:${String(recursive)}`);
      return Promise.reject(new Error('Directory exists')); // an existing folder must not abort
    });
    h.downloadFile.mockImplementation(({ directory }) => {
      order.push(`download:${directory}`);
      return Promise.resolve();
    });
    expect(await downloadSong(song('m'))).toBe(true);
    expect(order).toEqual(['mkdir:DATA:vinax-downloads:true', 'download:DATA']);
    expect(h.httpGet).not.toHaveBeenCalled(); // no base64 bridge transfer
  });

  it('passes connect and read timeouts to the native downloader', async () => {
    expect(await downloadSong(song('t'))).toBe(true);
    const opts = h.downloadFile.mock.calls[0][0];
    expect(opts.connectTimeout).toBeGreaterThan(0);
    expect(opts.readTimeout).toBeGreaterThan(0);
    expect(opts.path).toBe('vinax-downloads/t.mp4');
  });

  it('walks the bitrate ladder when the top variant does not exist', async () => {
    h.downloadFile.mockImplementation(({ url }) =>
      url.includes('320') || url.includes('160') ? Promise.reject(notFound(url)) : Promise.resolve(),
    );
    expect(await downloadSong(song('q'))).toBe(true);
    // 320 and 160 are each tried once (a 404 is not a directory problem), 96 lands.
    expect(h.downloadFile.mock.calls.map(([o]) => o.url)).toEqual([
      'https://cdn.test/q_320kbps.mp4',
      'https://cdn.test/q_160kbps.mp4',
      'https://cdn.test/q_96kbps.mp4',
    ]);
    expect(h.httpGet).not.toHaveBeenCalled(); // an HTTP error is not retried over the bridge
    expect(h.added).toEqual([{ id: 'q', dir: 'DATA' }]);
  });

  it('treats a tiny error body as a missing variant and moves down the ladder', async () => {
    h.stat.mockResolvedValueOnce({ size: 300 }).mockResolvedValue({ size: 4_000_000 });
    expect(await downloadSong(song('x'))).toBe(true);
    expect(h.downloadFile).toHaveBeenCalledTimes(2);
    expect(h.deleteFile).toHaveBeenCalledWith({ path: 'vinax-downloads/x.mp4', directory: 'DATA' });
  });

  it('reports "not available" when no variant exists', async () => {
    h.downloadFile.mockImplementation(({ url }) => Promise.reject(notFound(url)));
    expect(await downloadSong(song('n'))).toBe(false);
    expect(h.downloadFile).toHaveBeenCalledTimes(4);
    expect(lastDownloadFailure('n')).toBe('unavailable');
    expect(downloadFailureMessage(lastDownloadFailure('n'))).toMatch(/isn.t available to download/);
    expect(h.errors[0]).toContain('unavailable'); // telemetry keeps the underlying reason
  });

  it('fails fast with "no internet" when the device is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(await downloadSong(song('o'))).toBe(false);
    expect(h.downloadFile).not.toHaveBeenCalled();
    expect(lastDownloadFailure('o')).toBe('offline');
    expect(downloadFailureMessage('offline')).toMatch(/No internet connection/);
  });

  it('stops the ladder on a network error instead of trying every variant', async () => {
    h.downloadFile.mockRejectedValue(new Error('Error downloading file: Unable to resolve host "cdn.test"'));
    expect(await downloadSong(song('u'))).toBe(false);
    expect(h.downloadFile).toHaveBeenCalledTimes(1);
    expect(h.httpGet).not.toHaveBeenCalled();
    expect(lastDownloadFailure('u')).toBe('offline');
  });

  it('a download that never answers times out instead of hanging', async () => {
    vi.useFakeTimers();
    h.downloadFile.mockImplementation(() => new Promise<void>(() => undefined));
    const job = downloadSong(song('s'));
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(await job).toBe(false);
    expect(lastDownloadFailure('s')).toBe('timeout');
    expect(h.downloading).toEqual([['s', true], ['s', false]]);
  });

  it('falls back to the bridge transfer only when the native downloader itself fails', async () => {
    h.downloadFile.mockRejectedValue(new Error('"downloadFile" is not implemented on android'));
    h.httpGet.mockResolvedValue({ status: 200, data: 'AAAA' });
    expect(await downloadSong(song('f'))).toBe(true);
    expect(h.httpGet).toHaveBeenCalledTimes(1);
  });

  it('removes the partial file and falls back to device storage when app data fails', async () => {
    const order: string[] = [];
    h.downloadFile.mockImplementation(({ directory }) => {
      order.push(`download:${directory}`);
      return directory === 'DATA' ? Promise.reject(new Error('open failed: EACCES')) : Promise.resolve();
    });
    h.deleteFile.mockImplementation(({ directory }) => {
      order.push(`delete:${directory}`);
      return Promise.reject(new Error('nothing to delete')); // best-effort: must not abort the fallback
    });
    expect(await downloadSong(song('e'))).toBe(true);
    expect(order).toEqual(['download:DATA', 'delete:DATA', 'download:EXTERNAL']);
    expect(h.added).toEqual([{ id: 'e', dir: 'EXTERNAL' }]);
  });

  it('succeeds without waiting for the Cache API copy', async () => {
    let release: () => void = () => undefined;
    h.readFile.mockImplementation(
      () => new Promise((_, reject) => { release = () => reject(new Error('late')); }), // copy still running
    );
    vi.stubGlobal('caches', {
      open: () => Promise.resolve({ match: () => Promise.resolve(undefined), put: () => Promise.resolve() }),
    });
    expect(await downloadSong(song('w'))).toBe(true);
    expect(h.added).toEqual([{ id: 'w', dir: 'DATA' }]);
    // Playable straight away through the service-worker route and the file bridge.
    expect(getOfflineSources('w')).toEqual(['/offline-audio/w', 'bridge:file:///vinax-downloads/w.mp4']);
    await vi.waitFor(() => expect(h.readFile).toHaveBeenCalled());
    release();
  });
});

describe('downloadMany', () => {
  it('stops trying once the device is offline and says why', async () => {
    h.downloadFile.mockRejectedValue(new Error('Unable to resolve host "cdn.test"'));
    const res = await downloadMany([song('m1'), song('m2'), song('m3')]);
    expect(res).toEqual({ saved: 0, failed: 3, reason: 'offline' });
    expect(h.downloadFile).toHaveBeenCalledTimes(1);
  });

  it('reports no reason when everything saved', async () => {
    expect(await downloadMany([song('k1'), song('k2')])).toEqual({ saved: 2, failed: 0 });
  });
});

describe('downloadUrls', () => {
  it('orders every variant high → low by the number in its label and forces TLS', () => {
    const s = {
      id: 'l',
      audio: [
        { quality: '96', url: 'http://cdn.test/96.mp4' },
        { quality: '320 kbps', url: 'https://cdn.test/320.mp4' },
        { quality: '160kbps', url: 'https://cdn.test/160.mp4' },
        { quality: '48kbps', url: '' },
      ],
    } as unknown as Song;
    expect(downloadUrls(s)).toEqual(['https://cdn.test/320.mp4', 'https://cdn.test/160.mp4', 'https://cdn.test/96.mp4']);
  });
});

describe('classifyDownloadError', () => {
  it.each([
    ['Error downloading file: https://cdn.test/a.mp4', 'unavailable'],
    ['Server returned HTTP response code: 403 for URL: https://cdn.test/a', 'unavailable'],
    ['http 404', 'unavailable'],
    ['Unable to resolve host "cdn.test": No address associated with hostname', 'offline'],
    ['failed to connect to cdn.test/1.2.3.4 (port 443)', 'offline'],
    ['Read timed out', 'timeout'],
    ['write failed: ENOSPC (No space left on device)', 'storage'],
    ['/data/user/0/app/files/vinax-downloads/a.mp4: open failed: ENOENT (No such file or directory)', 'storage'],
    ['Server returned HTTP response code: 502 for URL: https://x', 'unknown'],
  ])('%s → %s', (msg, reason) => {
    expect(classifyDownloadError(new Error(msg))).toBe(reason);
  });
});

describe('offline sources', () => {
  /** A fake Cache API bucket keyed by path. */
  function stubCaches() {
    const store = new Map<string, Response>();
    const cache = {
      match: (k: string) => Promise.resolve(store.get(k)),
      put: (k: string, r: Response) => {
        store.set(k, r);
        return Promise.resolve();
      },
      delete: (k: string) => Promise.resolve(store.delete(k)),
    };
    vi.stubGlobal('caches', { open: () => Promise.resolve(cache) });
    return store;
  }

  it('rebuilds a missing cache entry from the file on disk, in slices', async () => {
    const store = stubCaches();
    const SLICE = 3 * 1024 * 1024;
    const total = SLICE + 1000;
    h.readFile.mockImplementation(({ offset = 0, length = total }) => {
      const n = Math.max(0, Math.min(length, total - offset));
      return Promise.resolve({ data: new Blob([new Uint8Array(n)]) });
    });
    h.items.r = { path: 'vinax-downloads/r.mp4', uri: 'file:///r.mp4', dir: 'DATA' };
    // First ask: the entry state is unknown, so the SW route is offered and a rebuild starts.
    expect(getOfflineSources('r')).toEqual(['/offline-audio/r', 'bridge:file:///r.mp4']);
    await vi.waitFor(() => expect(store.has('/offline-audio/r')).toBe(true));
    expect(h.readFile.mock.calls.map(([o]) => [o.offset, o.length])).toEqual([
      [0, SLICE],
      [SLICE, SLICE],
    ]);
    const res = store.get('/offline-audio/r');
    expect(res?.headers.get('content-length')).toBe(String(total));
    await vi.waitFor(() => expect(getOfflineUrl('r')).not.toBeNull());
    await removeDownload('r');
    expect(store.has('/offline-audio/r')).toBe(false);
  });

  it('copes with an older plugin that ignores offset/length (whole file at once)', async () => {
    const store = stubCaches();
    h.readFile.mockResolvedValue({ data: new Blob([new Uint8Array(4 * 1024 * 1024)]) });
    h.items.g = { path: 'vinax-downloads/g.mp4', uri: 'file:///g.mp4', dir: 'EXTERNAL' };
    getOfflineSources('g');
    await vi.waitFor(() => expect(store.has('/offline-audio/g')).toBe(true));
    expect(h.readFile).toHaveBeenCalledTimes(1);
    expect(h.readFile.mock.calls[0][0].directory).toBe('EXTERNAL');
    await removeDownload('g');
  });

  it('drops the SW route once its entry is known to be missing, keeping the file bridge', async () => {
    stubCaches();
    h.readFile.mockRejectedValue(new Error('File does not exist'));
    h.items.z = { path: 'vinax-downloads/z.mp4', uri: 'file:///z.mp4', dir: 'DATA' };
    getOfflineSources('z');
    await vi.waitFor(() => expect(getOfflineSources('z')).toEqual(['bridge:file:///z.mp4']));
    await removeDownload('z');
  });
});
