import { describe, expect, it } from 'vitest';
import { outcomeFor } from './transitionTracker';

describe('outcomeFor', () => {
  it('judges a play by how much of it was heard', () => {
    expect(outcomeFor(180, 200)).toBe('completed');
    expect(outcomeFor(140, 200)).toBe('completed');
    expect(outcomeFor(20, 200)).toBe('skipped');
    expect(outcomeFor(100, 200)).toBeNull();
    expect(outcomeFor(50, 0)).toBeNull();
  });
});
