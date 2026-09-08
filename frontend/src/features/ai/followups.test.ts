import { describe, expect, it } from 'vitest';
import { hideFollowupLine, splitFollowups } from './followups';

describe('followups', () => {
  it('lifts the trailing >>> line into chips', () => {
    const r = splitFollowups('Here is the answer.\n\nMore detail.\n>>> Show an example | Make it shorter | "Why?"');
    expect(r.body).toBe('Here is the answer.\n\nMore detail.');
    expect(r.followups).toEqual(['Show an example', 'Make it shorter', 'Why?']);
  });
  it('leaves replies without a marker untouched', () => {
    const r = splitFollowups('Plain reply\n>>> not at the end\nlast line here\nand another\nand more');
    expect(r.followups).toEqual([]);
    expect(r.body).toContain('Plain reply');
  });
  it('caps at three and drops junk', () => {
    const r = splitFollowups('x\n>>> a | bb | ccc | dddd | e');
    expect(r.followups).toEqual(['ccc', 'dddd']);
  });
  it('hides a partial marker while streaming', () => {
    expect(hideFollowupLine('Answer\n>>')).toBe('Answer');
    expect(hideFollowupLine('Answer\n>>> Show')).toBe('Answer');
    expect(hideFollowupLine('Answer\nnext line')).toBe('Answer\nnext line');
    expect(hideFollowupLine('Answer >>> inline')).toBe('Answer >>> inline');
  });
});
