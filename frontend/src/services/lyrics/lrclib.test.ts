// @vitest-environment jsdom
/**
 * Lyrics-service caching rules: a failed request is never remembered as "no
 * hits", and two recordings that share a title and first artist but differ in
 * length never share synced lines.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLyricsCaches, fetchLrclibLyrics, searchLyrics } from './lrclib';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const record = (trackName: string, plainLyrics: string, extra: Record<string, unknown> = {}) => ({
  trackName,
  artistName: 'Singer',
  albumName: 'Film',
  duration: 240,
  plainLyrics,
  syncedLyrics: null,
  ...extra,
});

beforeEach(() => clearLyricsCaches());
afterEach(() => vi.unstubAllGlobals());

describe('searchLyrics caching', () => {
  it('does not cache a failed request as "no hits"', async () => {
    const fetchSpy = vi
      .fn<(url: string) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockImplementationOnce(() => json({ message: 'busy' }, 503))
      .mockImplementationOnce(() => json({ unexpected: 'shape' }))
      .mockImplementation(() => json([record('Tum Hi Ho', 'hum tere bin ab reh nahi sakte')]));
    vi.stubGlobal('fetch', fetchSpy);

    expect(await searchLyrics('hum tere bin')).toEqual([]); // network error
    expect(await searchLyrics('hum tere bin')).toEqual([]); // HTTP 503
    expect(await searchLyrics('hum tere bin')).toEqual([]); // not a list
    const hits = await searchLyrics('hum tere bin');
    expect(hits.map((h) => h.title)).toEqual(['Tum Hi Ho']);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('caches a real answer — including a real empty list', async () => {
    const fetchSpy = vi.fn((url: string) =>
      url.includes('nothing') ? json([]) : json([record('Kesariya', 'kesariya tera ishq hai piya')]),
    );
    vi.stubGlobal('fetch', fetchSpy);
    expect(await searchLyrics('kesariya tera')).toHaveLength(1);
    expect(await searchLyrics('  Kesariya   TERA ')).toHaveLength(1);
    expect(await searchLyrics('nothing here')).toEqual([]);
    expect(await searchLyrics('nothing here')).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('an aborted search rejects and leaves no cache entry', async () => {
    const fetchSpy = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new AbortController();
    const pending = searchLyrics('tum hi ho', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    fetchSpy.mockImplementation(() => json([record('Tum Hi Ho', 'tum hi ho')]));
    expect(await searchLyrics('tum hi ho')).toHaveLength(1);
  });

  it('builds the snippet around a Hindi word without shredding it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => json([record('Tum Hi Ho', `${'la '.repeat(80)}\nक्योंकि तुम ही हो\nअब तुम ही हो`)])),
    );
    const [hit] = await searchLyrics('सिर्फ़ तुम');
    expect(hit.snippet).toContain('तुम ही हो');
  });
});

describe('fetchLrclibLyrics cache key', () => {
  const synced = (line: string) => `[00:01.00] ${line}`;

  it('keeps two recordings of different length apart', async () => {
    const fetchSpy = vi.fn((url: string) => {
      const duration = new URL(url).searchParams.get('duration');
      return json(record('Channa Mereya', 'x', { syncedLyrics: synced(duration === '289' ? 'film cut' : 'unplugged') }));
    });
    vi.stubGlobal('fetch', fetchSpy);

    const film = await fetchLrclibLyrics('Channa Mereya', 'Singer', 289.2);
    const unplugged = await fetchLrclibLyrics('Channa Mereya', 'Singer', 391);
    expect(film?.synced?.[0].text).toBe('film cut');
    expect(unplugged?.synced?.[0].text).toBe('unplugged');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Same recording (length rounds to the same second) → served from cache.
    expect((await fetchLrclibLyrics('channa mereya', 'SINGER', 288.6))?.synced?.[0].text).toBe('film cut');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('matches a native-script title in the search fallback', async () => {
    const fetchSpy = vi.fn((url: string) =>
      url.includes('/get?')
        ? json({ message: 'not found' }, 404)
        : json([
            record('दाल', 'x', { syncedLyrics: synced('wrong song') }),
            record('दिल', 'x', { syncedLyrics: synced('right song') }),
          ]),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const out = await fetchLrclibLyrics('दिल', 'Singer', 240);
    expect(out?.synced?.[0].text).toBe('right song');
  });
});
