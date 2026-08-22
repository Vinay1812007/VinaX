import { describe, it, expect } from 'vitest';
import { artSrcSet, bestImage, derivedVariants, FALLBACK_ART } from './images';

describe('derivedVariants (4.19.5 — CDN serves unlisted 250/350 sizes)', () => {
  const imgs = [
    { quality: '50x50', url: 'https://c.saavncdn.com/x/a-50x50.jpg' },
    { quality: '150x150', url: 'https://c.saavncdn.com/x/a-150x150.jpg' },
    { quality: '500x500', url: 'https://c.saavncdn.com/x/a-500x500.jpg' },
  ];
  it('derives 250 and 350 by rewriting the 500 URL', () => {
    const out = derivedVariants(imgs);
    expect(out.map((v) => v.quality).sort()).toStrictEqual(['150x150', '250x250', '350x350', '500x500', '50x50'].sort());
    expect(out.find((v) => v.quality === '350x350')?.url).toBe('https://c.saavncdn.com/x/a-350x350.jpg');
  });
  it('passes through untouched when no 500x500 URL exists to rewrite', () => {
    const odd = [{ quality: '500x500', url: 'https://elsewhere.example/full.jpg' }];
    expect(derivedVariants(odd)).toStrictEqual(odd);
    expect(derivedVariants(undefined)).toStrictEqual([]);
  });
  it('feeds a retina-friendly capped srcset (350 max) for card tiles', () => {
    expect(artSrcSet(derivedVariants(imgs), 350)).toBe(
      'https://c.saavncdn.com/x/a-50x50.jpg 50w, https://c.saavncdn.com/x/a-150x150.jpg 150w, https://c.saavncdn.com/x/a-250x250.jpg 250w, https://c.saavncdn.com/x/a-350x350.jpg 350w',
    );
    expect(bestImage(derivedVariants(imgs), 250)).toBe('https://c.saavncdn.com/x/a-250x250.jpg');
  });
});

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

  it('caps offered variants at maxPx (4.18.0 — card tiles must not fetch 500×500)', () => {
    expect(artSrcSet(imgs, 150)).toBe('small 50w, mid 150w');
    expect(artSrcSet(imgs, 499)).toBe('small 50w, mid 150w');
    expect(artSrcSet(imgs, 500)).toBe('small 50w, mid 150w, large 500w');
  });

  it('ignores a cap that would remove every variant', () => {
    expect(artSrcSet(imgs, 10)).toBe('small 50w, mid 150w, large 500w');
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
