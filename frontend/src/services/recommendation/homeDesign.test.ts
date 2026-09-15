import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME, validateHomeDesign } from './homeDesign';

describe('home design validation', () => {
  it('keeps only known shelves and restores missing shelves', () => {
    const design = validateHomeDesign({ order: ['feed', 'feed', 'unknown', 'quick'], hidden: ['quick', 'unknown'] });
    expect(design.order[0]).toBe('feed');
    expect(design.order).toHaveLength(DEFAULT_HOME.order.length);
    expect(design.order.filter((key, i, all) => all.indexOf(key) === i)).toHaveLength(DEFAULT_HOME.order.length);
    expect(design.hidden).toEqual(['quick']);
  });

  it('rejects unsafe or empty copy while bounding user text', () => {
    const design = validateHomeDesign({ title: '<script>alert(1)</script>', description: 'Spotify playlist', order: [] });
    expect(design.title).toBe(DEFAULT_HOME.title);
    expect(design.description).toBe(DEFAULT_HOME.description);
    expect(design.order).toEqual(DEFAULT_HOME.order);
  });
});
