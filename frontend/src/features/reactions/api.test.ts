import { describe, expect, it } from 'vitest';
import { applyLocally, isReaction, REACTIONS, toggled } from './api';

describe('1.12 — song reactions on the device', () => {
  it('five reactions, each with a glyph', () => {
    expect(REACTIONS.map((r) => r.id)).toEqual(['fire', 'love', 'sad', 'dance', 'wow']);
    expect(isReaction('fire')).toBe(true);
    expect(isReaction('thumbs')).toBe(false);
  });

  it('tapping the same reaction again takes it away; another one replaces it', () => {
    expect(toggled(null, 'fire')).toBe('fire');
    expect(toggled('fire', 'fire')).toBeNull();
    expect(toggled('fire', 'love')).toBe('love');
  });

  it('moves the counts at once: minus the old one, plus the new one', () => {
    const c = { total: 5, counts: { fire: 3, love: 2 }, mine: 'fire' as const };
    expect(applyLocally(c, 'love')).toEqual({ total: 5, counts: { fire: 2, love: 3 }, mine: 'love' });
    expect(applyLocally(c, null)).toEqual({ total: 4, counts: { fire: 2, love: 2 }, mine: null });
    expect(applyLocally({ total: 0, counts: {}, mine: null }, 'wow')).toEqual({ total: 1, counts: { wow: 1 }, mine: 'wow' });
  });
});
