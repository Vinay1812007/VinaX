import { describe, it, expect } from 'vitest';
import { artSrcSet, bestImage, FALLBACK_ART } from './images';

describe('bestImage', () => {
  const imgs = [
    { quality: '50x50', url: 'small' },
    { quality: '150x150', url: 'mid' },
    { quality: '500x500', url: 'large' },
  ];

  it('returns fallback art for empty/undefined input', () => {
    expect(bestImage([])).toBe(FALLBACK_ART);
    expect(bestImage(undefined)).toBe(FALLBACK_ART);
  });

  it('picks the smallest image at least `min` px', () => {
    expect(bestImage(imgs, 150)).toBe('mid');
    expect(bestImage(imgs, 60)).toBe('mid');
    expect(bestImage(imgs, 50)).toBe('small');
  });

  it('falls back to the largest when none meet `min`', () => {
    expect(bestImage(imgs, 1000)).toBe('large');
  });
});

describe('artSrcSet', () => {
  const imgs = [
    { quality: '500x500', url: 'large' },
    { quality: '50x50', url: 'small' },
    { quality: '150x150', url: 'mid' },
  ];

  it('builds an ascending width-descriptor srcset from catalog variants', () => {
    expect(artSrcSet(imgs)).toBe('small 50w, mid 150w, large 500w');
  });

  it('returns undefined when there is nothing useful to negotiate', () => {
    expect(artSrcSet(undefined)).toBeUndefined();
    expect(artSrcSet([])).toBeUndefined();
    expect(artSrcSet([imgs[0]])).toBeUndefined();
    expect(artSrcSet([{ quality: 'high', url: 'x' }])).toBeUndefined();
  });
});

describe('malformed input (corrupt persisted state) — DQA-04', () => {
  it('bestImage never throws on non-array values', () => {
    expect(bestImage('not-an-array' as never)).toBe(FALLBACK_ART);
    expect(bestImage(42 as never)).toBe(FALLBACK_ART);
    expect(bestImage({ url: 'x' } as never)).toBe(FALLBACK_ART);
    expect(bestImage(null as never)).toBe(FALLBACK_ART);
  });

  it('bestImage skips malformed entries inside a real array', () => {
    const mixed = [null, 'junk', { quality: 7 }, { quality: '150x150', url: 'ok' }] as never;
    expect(bestImage(mixed, 100)).toBe('ok');
    expect(bestImage([null, undefined] as never)).toBe(FALLBACK_ART);
    expect(bestImage([{ quality: undefined, url: 'still-ok' }] as never)).toBe('still-ok');
  });

  it('artSrcSet never throws on non-array or malformed entries', () => {
    expect(artSrcSet('nope' as never)).toBeUndefined();
    expect(artSrcSet([null, { quality: '50x50' }] as never)).toBeUndefined();
  });
});
