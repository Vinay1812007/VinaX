import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

/**
 * 1.16 — web saves (services/downloads/web.ts) through the public entry
 * points the song menu and the player use: downloadSong, getOfflineSources,
 * removeDownload, initDownloads. The Cache API and fetch are fakes.
 */

const h = vi.hoisted(() => ({
  errors: [] as string[],
  toasts: [] as string[],
  ios: false,
  standalone: false,
  getSong: vi.fn<(id: string) => Promise<Song>>(),
  navigate: vi.fn<(to: string) => void>(),
}));
vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));
vi.mock('@/services/api', () => ({ getSong: h.getSong }));
vi.mock('@/services/analytics/telemetry', () => ({
  reportError: (_kind: string, msg: string) => h.errors.push(msg),
  trackDownload: () => undefined,
}));
vi.mock('@/store/toastStore', () => ({ toast: (m: string) => h.toasts.push(m) }));
vi.mock('@/utils/platform', () => ({ iosWeb: () => h.ios, standaloneWeb: () => h.standalone }));
vi.mock('@/router', () => ({ router: { navigate: h.navigate } }));

const { useDownloadsStore } = await import('@/store/downloadsStore');
const { canSaveOffline, downloadSong, downloadFailureMessage, getOfflineSources, initDownloads, lastDownloadFailure, removeDownload } =
  await import('./index');
const { savableUrl, fetchAudio, resetSaveNotes, MIN_FREE_BYTES, WARN_BYTES } = await import('./web');

const AUDIO = 'vinax-audio-v1';
const ORIGIN = 'https://www.vinaxmusic.online';
const LADDER = ['320kbps', '160kbps', '96kbps', '48kbps'];
const song = (id: string, host = 'https://aac.saavncdn.com'): Song =>
  ({
    id,
    title: `Song ${id}`,
    audio: LADDER.map((q) => ({ quality: q, url: `${host}/${id}_${q}.mp4` })),
  }) as unknown as Song;

/** A Cache API with one bucket per name, keyed by URL string. */
function fakeCaches() {
  const buckets = new Map<string, Map<string, Response>>();
  const bucket = (name: string) => {
    let b = buckets.get(name);
    if (!b) buckets.set(name, (b = new Map()));
    return b;
  };
  const api = {
    open: vi.fn((name: string) =>
      Promise.resolve({
        put: (k: string, r: Response) => {
          bucket(name).set(k, r);
          return Promise.resolve();
        },
        match: (k: string) => Promise.resolve(bucket(name).get(k)?.clone()),
        delete: (k: string) => Promise.resolve(bucket(name).delete(k)),
      }),
    ),
  };
  return { api, buckets, bucket };
}

const audioBody = (n = 64 * 1024) => new Uint8Array(n);
const audioRes = (n?: number) => new Response(audioBody(n), { status: 200, headers: { 'content-type': 'audio/mp4' } });

let cache: ReturnType<typeof fakeCaches>;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;
let persist: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
let estimate: { usage: number; quota: number };
let controller: object | null;

beforeEach(() => {
  h.errors = [];
  h.toasts = [];
  h.ios = false;
  h.standalone = false;
  h.getSong.mockReset().mockRejectedValue(new Error('not looked up'));
  useDownloadsStore.setState({ items: {}, downloading: {} });
  cache = fakeCaches();
  fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(audioRes()));
  persist = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
  estimate = { usage: 10 * 1024 * 1024, quota: 10 * 1024 * 1024 * 1024 };
  controller = {};
  vi.stubGlobal('caches', cache.api);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { origin: ORIGIN });
  vi.stubGlobal('navigator', {
    onLine: true,
    get serviceWorker() {
      return { controller };
    },
    storage: { persist, persisted: () => Promise.resolve(false), estimate: () => Promise.resolve(estimate) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('web saves', () => {
  it('the song menu offers Download in a browser with the Cache API, not without one', () => {
    expect(canSaveOffline()).toBe(true);
    vi.stubGlobal('caches', undefined);
    expect(canSaveOffline()).toBe(false);
  });

  it('fetches the audio with CORS into the bucket the service worker serves, and keeps a store entry', async () => {
    expect(await downloadSong(song('a'))).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://aac.saavncdn.com/a_320kbps.mp4');
    expect(init).toMatchObject({ mode: 'cors', credentials: 'omit' });
    const hit = cache.bucket(AUDIO).get('/offline-audio/a');
    expect(hit).toBeDefined();
    expect(hit?.headers.get('content-type')).toBe('audio/mp4');
    expect(hit?.headers.get('accept-ranges')).toBe('bytes');
    expect(hit?.headers.get('content-length')).toBe(String(64 * 1024));
    const item = useDownloadsStore.getState().items.a;
    expect(item.path).toBeUndefined();
    expect(item.bytes).toBe(64 * 1024);
    expect(useDownloadsStore.getState().downloading).toEqual({});
    expect(lastDownloadFailure('a')).toBeNull();
  });

  it('playback prefers the saved copy through the service worker once saved', async () => {
    expect(getOfflineSources('p')).toEqual([]);
    await downloadSong(song('p'));
    expect(getOfflineSources('p')).toEqual(['/offline-audio/p']);
  });

  it('a page the worker does not control yet plays a blob: copy from the second play on', async () => {
    const created = vi.fn(() => 'blob:saved-u');
    vi.stubGlobal('URL', Object.assign(globalThis.URL, { createObjectURL: created }));
    await downloadSong(song('u'));
    controller = null;
    expect(getOfflineSources('u')).toEqual([]);
    await vi.waitFor(() => expect(created).toHaveBeenCalled());
    expect(getOfflineSources('u')).toEqual(['blob:saved-u']);
  });

  it('walks the bitrate ladder when a variant is missing', async () => {
    fetchMock.mockImplementation((url) => Promise.resolve(url.includes('320') ? new Response('nope', { status: 404 }) : audioRes()));
    expect(await downloadSong(song('l'))).toBe(true);
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(['https://aac.saavncdn.com/l_320kbps.mp4', 'https://aac.saavncdn.com/l_160kbps.mp4']);
  });

  it('says "Not available to save" when the host refuses CORS, and stores nothing', async () => {
    // The CORS fetch rejects; a no-cors probe still reaches the server.
    fetchMock.mockImplementation((_url, init) =>
      init?.mode === 'no-cors' ? Promise.resolve(new Response(null, { status: 200 })) : Promise.reject(new TypeError('Failed to fetch')),
    );
    expect(await downloadSong(song('c'))).toBe(false);
    expect(lastDownloadFailure('c')).toBe('blocked');
    expect(downloadFailureMessage(lastDownloadFailure('c'))).toBe('Not available to save');
    // One refusal stops the ladder: every variant is on the same host.
    expect(fetchMock.mock.calls.filter(([, i]) => i?.mode === 'cors')).toHaveLength(1);
    expect(cache.bucket(AUDIO).size).toBe(0);
    expect(useDownloadsStore.getState().items.c).toBeUndefined();
    expect(h.errors[0]).toMatch(/"Song c": blocked: /);
  });

  it('never stores an opaque answer', async () => {
    const opaque = new Response(null, { status: 200 });
    Object.defineProperty(opaque, 'type', { value: 'opaque' });
    fetchMock.mockResolvedValue(opaque);
    expect(await downloadSong(song('o'))).toBe(false);
    expect(lastDownloadFailure('o')).toBe('blocked');
    expect(cache.bucket(AUDIO).size).toBe(0);
  });

  it('a dead network is "offline", not "not available"', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await downloadSong(song('n'))).toBe(false);
    expect(lastDownloadFailure('n')).toBe('offline');
  });

  it('a host the page may not fetch from is refused without a request', async () => {
    expect(await downloadSong(song('x', 'https://media.example.com'))).toBe(false);
    expect(lastDownloadFailure('x')).toBe('blocked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an error page that arrives with a 200 is not saved as a song', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('<Error>Access Denied</Error>', { headers: { 'content-type': 'application/xml' } })));
    expect(await downloadSong(song('e'))).toBe(false);
    expect(lastDownloadFailure('e')).toBe('unavailable');
    expect(cache.bucket(AUDIO).size).toBe(0);
  });

  it('a nearly full browser storage refuses before downloading', async () => {
    estimate = { usage: 1000, quota: 1000 + MIN_FREE_BYTES - 1 };
    expect(await downloadSong(song('f'))).toBe(false);
    expect(lastDownloadFailure('f')).toBe('storage');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a full cache on write is a storage failure', async () => {
    cache.api.open.mockResolvedValue({
      put: () => Promise.reject(new DOMException('quota', 'QuotaExceededError')),
      match: () => Promise.resolve(undefined),
      delete: () => Promise.resolve(false),
    });
    expect(await downloadSong(song('q'))).toBe(false);
    expect(lastDownloadFailure('q')).toBe('storage');
    expect(useDownloadsStore.getState().items.q).toBeUndefined();
  });

  it('asks the browser to keep the storage on the first save only, and nudges an iPhone to the Home Screen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    h.ios = true;
    resetSaveNotes();
    await downloadSong(song('i1'));
    await downloadSong(song('i2'));
    await vi.runAllTimersAsync();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(h.toasts).toEqual(['Add VinaX to your Home Screen so Safari keeps your saved songs']);
  });

  it('installed or not on an iPhone, a total over 1 GB gets one note', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    resetSaveNotes();
    estimate = { usage: WARN_BYTES + 1, quota: 4 * WARN_BYTES };
    await downloadSong(song('b1'));
    await downloadSong(song('b2'));
    await vi.runAllTimersAsync();
    expect(h.toasts).toEqual(['Saved songs now use over 1 GB on this device']);
  });

  it('removeDownload deletes the cached audio and the entry', async () => {
    await downloadSong(song('r'));
    await removeDownload('r');
    expect(cache.bucket(AUDIO).has('/offline-audio/r')).toBe(false);
    expect(useDownloadsStore.getState().items.r).toBeUndefined();
    expect(getOfflineSources('r')).toEqual([]);
  });

  it('on boot, drops saves the browser has cleared', async () => {
    await downloadSong(song('k'));
    await downloadSong(song('gone'));
    cache.bucket(AUDIO).delete('/offline-audio/gone');
    await initDownloads();
    expect(Object.keys(useDownloadsStore.getState().items)).toEqual(['k']);
  });

  it('on boot, keeps every save when the cache cannot be read', async () => {
    await downloadSong(song('s'));
    cache.api.open.mockRejectedValue(new Error('SecurityError'));
    await initDownloads();
    expect(Object.keys(useDownloadsStore.getState().items)).toEqual(['s']);
  });
});

describe('savableUrl', () => {
  it('allows this site and the hosts the CSP lets the page fetch from', () => {
    expect(savableUrl('/api/cat/stream?e=x', ORIGIN)).toBe(true);
    expect(savableUrl('https://aac.saavncdn.com/a.mp4', ORIGIN)).toBe(true);
    expect(savableUrl('https://www.vinaxmusic.online/api/cat/stream?e=x', 'http://127.0.0.1:5173')).toBe(true);
    expect(savableUrl('http://aac.saavncdn.com/a.mp4', ORIGIN)).toBe(false);
    expect(savableUrl('https://evil-saavncdn.com/a.mp4', ORIGIN)).toBe(false);
    // The CSP's wildcards need a subdomain: the bare names would be blocked.
    expect(savableUrl('https://saavncdn.com/a.mp4', ORIGIN)).toBe(false);
    expect(savableUrl('https://vinaxmusic.online/api/cat/stream?e=x', ORIGIN)).toBe(false);
    expect(savableUrl('https://media.example.com/a.mp3', ORIGIN)).toBe(false);
  });
});

describe('fetchAudio', () => {
  it('a stalled transfer times out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fetchMock.mockImplementation(
      (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
    );
    const p = fetchAudio('https://aac.saavncdn.com/t.mp4').catch((e: { reason?: string }) => e.reason);
    await vi.runAllTimersAsync();
    expect(await p).toBe('timeout');
  });
});
