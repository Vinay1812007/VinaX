/**
 * 13.9 — canvas quality: the rendition ladder, the pick, and the thrifty
 * HEAD probe (the clip CDN serves 540p and 360p today; anything above is
 * probed once a day until it exists, then per clip).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { qualityBadge, qualityLabel, renditionHeight, renditionUrl } from '@/services/api/videos';
import { autoTarget, availableRenditions, pickRendition, PROBE_EVERY_MS, readPreference, resetRenditionMemo, writePreference } from './quality';

const CLIP = 'https://videos.example/preview/867/abc/20221208184237_v_540p_p.mp4';
/** A real clock: a fresh device (no note yet) probes at once, so "now" must be far from 0. */
const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

const head = (existing: number[]) =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe('HEAD');
    const h = renditionHeight(String(input)) ?? 0;
    return new Response(null, { status: existing.includes(h) ? 200 : 404 });
  }) as unknown as typeof fetch;

describe('rendition urls', () => {
  it('reads and rewrites the height marker', () => {
    expect(renditionHeight(CLIP)).toBe(540);
    expect(renditionHeight('https://x/clip.mp4')).toBeNull();
    expect(renditionUrl(CLIP, 1080)).toBe('https://videos.example/preview/867/abc/20221208184237_v_1080p_p.mp4');
    expect(renditionUrl(`${CLIP}?t=1`, 360)).toBe('https://videos.example/preview/867/abc/20221208184237_v_360p_p.mp4?t=1');
    expect(renditionUrl('https://x/clip.mp4', 1080)).toBeNull();
  });

  it('labels heights the way a listener reads them', () => {
    expect(qualityLabel(2160)).toBe('4K');
    expect(qualityLabel(1080)).toBe('Full HD 1080p');
    expect(qualityLabel(720)).toBe('HD 720p');
    expect(qualityLabel(540)).toBe('540p');
    expect(qualityBadge(2160)).toBe('4K');
    expect(qualityBadge(540)).toBe('540p');
  });
});

describe('pickRendition', () => {
  const list = [2160, 1080, 540, 360].map((h) => ({ height: h, url: `u${h}` }));
  it('Auto takes the highest that fits the screen, else the lowest', () => {
    expect(pickRendition(list, 'auto', 1200)?.height).toBe(1080);
    expect(pickRendition(list, 'auto', 4000)?.height).toBe(2160);
    expect(pickRendition(list, 'auto', 100)?.height).toBe(360);
  });
  it('a pinned height is honoured, else the nearest below it, else the lowest above', () => {
    expect(pickRendition(list, 1080, 100)?.height).toBe(1080);
    expect(pickRendition(list, 720, 100)?.height).toBe(540);
    expect(pickRendition(list, 240, 100)?.height).toBe(360);
  });
  it('skips renditions that failed to play', () => {
    expect(pickRendition(list, 'auto', 4000, new Set([2160, 1080]))?.height).toBe(540);
    expect(pickRendition(list, 'auto', 4000, new Set([2160, 1080, 540, 360]))).toBeNull();
  });
  it('autoTarget is the longer side in device pixels, between 360 and 4K', () => {
    expect(autoTarget({ width: 390, height: 844, dpr: 3 })).toBe(2160);
    expect(autoTarget({ width: 1366, height: 768, dpr: 1 })).toBe(1366);
    expect(autoTarget({ width: 200, height: 100, dpr: 1 })).toBe(360);
  });
});

describe('quality preference', () => {
  it('round-trips a known height and falls back to auto otherwise', () => {
    const st = new MemoryStorage();
    expect(readPreference(st)).toBe('auto');
    writePreference(1080, st);
    expect(readPreference(st)).toBe(1080);
    writePreference('auto', st);
    expect(readPreference(st)).toBe('auto');
    st.setItem('vinax.canvas.quality.v1', '999');
    expect(readPreference(st)).toBe('auto');
  });
});

describe('availableRenditions', () => {
  beforeEach(resetRenditionMemo);

  it('a clip without a height marker is itself, unlabelled', async () => {
    const f = head([]);
    expect(await availableRenditions('https://x/clip.mp4', { fetchImpl: f, storage: new MemoryStorage() })).toEqual([{ height: 0, url: 'https://x/clip.mp4' }]);
    expect(f).not.toHaveBeenCalled();
  });

  it('probes above the named height once, lists the named one and the ones below without asking', async () => {
    const f = head([]);
    const st = new MemoryStorage();
    const list = await availableRenditions(CLIP, { fetchImpl: f, storage: st, now: T0 });
    expect(list.map((r) => r.height)).toEqual([540, 360]);
    // 2160, 1440, 1080, 720 were asked once each.
    expect(f).toHaveBeenCalledTimes(4);
    // The next clip on the same day asks nothing more.
    resetRenditionMemo();
    const again = await availableRenditions(CLIP.replace('abc', 'def'), { fetchImpl: f, storage: st, now: T0 + 60_000 });
    expect(again.map((r) => r.height)).toEqual([540, 360]);
    expect(f).toHaveBeenCalledTimes(4);
    // A day later it asks again.
    resetRenditionMemo();
    await availableRenditions(CLIP.replace('abc', 'ghi'), { fetchImpl: f, storage: st, now: T0 + PROBE_EVERY_MS });
    expect(f).toHaveBeenCalledTimes(8);
  });

  it('a rendition the CDN serves lights up, and every clip is then probed', async () => {
    const f = head([1080]);
    const st = new MemoryStorage();
    const list = await availableRenditions(CLIP, { fetchImpl: f, storage: st, now: T0 });
    expect(list.map((r) => r.height)).toEqual([1080, 540, 360]);
    expect(list[0].url).toContain('_v_1080p_p.mp4');
    resetRenditionMemo();
    await availableRenditions(CLIP.replace('abc', 'def'), { fetchImpl: f, storage: st, now: T0 + 1 });
    expect(f).toHaveBeenCalledTimes(8);
  });

  it('a probe that throws counts as missing', async () => {
    const f = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const list = await availableRenditions(CLIP, { fetchImpl: f, storage: new MemoryStorage(), now: T0 });
    expect(list.map((r) => r.height)).toEqual([540, 360]);
  });
});
