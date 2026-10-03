// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeFlag = { value: false };
vi.mock('@/services/native', () => ({ isNativePlatform: () => nativeFlag.value }));

import { KEYS } from '@/constants/storage-keys';
import { getLocal } from '@/services/storage/local';
import { fetchEdgeGeo, geoEndpoint, readGeoBody } from './cloudflare';
import { REGION_TTL_MS, resolveRegion } from './inference';

const EDGE = { country: 'IN', region: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata', source: 'edge', unknown: false };

function serve(body: unknown, init: { ok?: boolean; delayMs?: number } = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (_url: string, opts?: { signal?: AbortSignal }) => {
    if (init.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, init.delayMs);
        opts?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    return { ok: init.ok ?? true, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn as unknown as ReturnType<typeof vi.fn>;
}

/** Pin the browser's locale + zone so the fallback is deterministic. */
function browser(locale: string, zone: string | null): void {
  Object.defineProperty(window.navigator, 'languages', { value: [locale], configurable: true });
  Object.defineProperty(window.navigator, 'language', { value: locale, configurable: true });
  const real = Intl.DateTimeFormat;
  vi.stubGlobal('Intl', {
    ...Intl,
    DateTimeFormat: Object.assign(
      (...args: unknown[]) => {
        const f = new (real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);
        return { ...f, resolvedOptions: () => ({ ...f.resolvedOptions(), timeZone: zone ?? undefined }) };
      },
      real,
    ),
  });
}

beforeEach(() => {
  localStorage.clear();
  nativeFlag.value = false;
  browser('en-GB', 'Europe/London');
});
afterEach(() => vi.unstubAllGlobals());

describe('geoEndpoint', () => {
  it('is relative on the web', () => {
    expect(geoEndpoint()).toBe('/api/geo');
  });

  it('is absolute on Android, so the app actually reaches the edge (9.0 skipped it entirely)', () => {
    nativeFlag.value = true;
    expect(geoEndpoint()).toBe('https://www.sirimillavinay.online/api/geo');
  });
});

describe('readGeoBody', () => {
  it('reads the coarse fields', () => {
    expect(readGeoBody(EDGE, 5)).toEqual({ country: 'IN', regionLabel: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata', source: 'edge', resolvedAt: 5 });
  });

  it('accepts an older deployment that answers country + region only', () => {
    expect(readGeoBody({ country: 'IN', region: 'Telangana', source: 'edge' }, 5)).toMatchObject({ country: 'IN', regionLabel: 'Telangana', city: null, timezone: null });
  });

  it('rejects an unplaceable country', () => {
    for (const country of ['XX', 'T1', '', 'india', null, 42]) expect(readGeoBody({ country }, 5)).toBeNull();
  });

  it('rejects a non-object body', () => {
    expect(readGeoBody(null, 5)).toBeNull();
    expect(readGeoBody('IN', 5)).toBeNull();
  });
});

describe('resolveRegion', () => {
  const opts = { allowInference: true, manualCountry: null, manualRegionLabel: null };

  it('prefers the edge, and keeps its city and zone', async () => {
    serve(EDGE);
    const r = await resolveRegion(opts);
    expect(r).toMatchObject({ country: 'IN', regionLabel: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata', source: 'edge' });
    expect(getLocal(KEYS.region, null)).toMatchObject({ country: 'IN' });
  });

  it('falls back to browser locale + time zone when the edge says nothing', async () => {
    serve({ country: null, unknown: true });
    const r = await resolveRegion(opts);
    expect(r).toMatchObject({ country: 'GB', source: 'browser', timezone: 'Europe/London' });
  });

  it('falls back when the request fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await resolveRegion(opts)).toMatchObject({ country: 'GB', source: 'browser' });
  });

  it('falls back when the endpoint 404s (local dev, non-Cloudflare hosting)', async () => {
    serve('<!doctype html>', { ok: false });
    expect(await resolveRegion(opts)).toMatchObject({ country: 'GB', source: 'browser' });
  });

  it('gives up on a slow edge inside its timeout', async () => {
    serve(EDGE, { delayMs: 400 });
    // Real timers: the Intl stub above cannot be combined with fake ones.
    expect(await fetchEdgeGeo(20)).toBeNull();
  });

  it('a cancelled request answers null and never resolves late', async () => {
    serve(EDGE, { delayMs: 400 });
    const ctrl = new AbortController();
    const pending = fetchEdgeGeo(5_000, ctrl.signal);
    ctrl.abort();
    expect(await pending).toBeNull();
  });

  it('a signal already aborted does not even fetch', async () => {
    const fetchMock = serve(EDGE);
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await fetchEdgeGeo(5_000, ctrl.signal)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says unknown when neither the edge nor the browser can place the listener', async () => {
    browser('en', null);
    serve({ country: null, unknown: true });
    expect(await resolveRegion(opts)).toMatchObject({ country: null, source: 'unknown', timezone: null });
  });

  it('a manual override wins and asks the edge nothing', async () => {
    const fetchMock = serve(EDGE);
    const r = await resolveRegion({ ...opts, manualCountry: 'LK', manualRegionLabel: 'Western' });
    expect(r).toMatchObject({ country: 'LK', regionLabel: 'Western', source: 'manual', city: null });
    // The device's own zone still rides along.
    expect(r.timezone).toBe('Europe/London');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('inference off infers nothing and asks the edge nothing', async () => {
    const fetchMock = serve(EDGE);
    const r = await resolveRegion({ ...opts, allowInference: false });
    expect(r).toMatchObject({ country: null, regionLabel: null, city: null, source: 'unknown' });
    expect(r.timezone).toBe('Europe/London');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses a fresh cached edge answer instead of asking again', async () => {
    const first = serve(EDGE);
    await resolveRegion(opts);
    expect(first).toHaveBeenCalledTimes(1);
    const second = serve(EDGE);
    await resolveRegion(opts);
    expect(second).not.toHaveBeenCalled();
  });

  it('asks again once the cached answer is stale', async () => {
    serve(EDGE);
    await resolveRegion(opts);
    const stale = { ...(getLocal(KEYS.region, null) as unknown as Record<string, unknown>), resolvedAt: Date.now() - REGION_TTL_MS - 1 };
    localStorage.setItem(KEYS.region, JSON.stringify(stale));
    const again = serve(EDGE);
    await resolveRegion(opts);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('refresh ignores a fresh cached answer', async () => {
    serve(EDGE);
    await resolveRegion(opts);
    const again = serve({ ...EDGE, country: 'LK', region: 'Western', city: 'Colombo' });
    const r = await resolveRegion({ ...opts, refresh: true });
    expect(again).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ country: 'LK', city: 'Colombo' });
  });

  it('keeps a stale value rather than wiping it when a later read fails', async () => {
    serve(EDGE);
    await resolveRegion(opts);
    const stale = { ...(getLocal(KEYS.region, null) as unknown as Record<string, unknown>), resolvedAt: Date.now() - REGION_TTL_MS - 1 };
    localStorage.setItem(KEYS.region, JSON.stringify(stale));
    browser('en', null); // the browser cannot place it either
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await resolveRegion(opts)).toMatchObject({ country: 'IN', source: 'edge' });
  });
});
