import { describe, expect, it } from 'vitest';
import { FESTIVALS } from './festivals';
import { festivalVisual } from './festivalVisuals';

describe('festival visual system', () => {
  it('provides a real photo and motion treatment for every calendar entry', () => {
    for (const festival of FESTIVALS) {
      const visual = festivalVisual(festival.id);
      expect(visual.image, festival.id).toMatch(/^https:\/\/images\.unsplash\.com\//);
      expect(visual.confetti, festival.id).toMatch(/^(powder|petal|lantern|snow|spark|ribbon|leaf|feather)$/);
      expect(visual.position, festival.id).toBeTruthy();
    }
  });
});
