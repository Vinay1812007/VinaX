import { describe, expect, it } from 'vitest';
import { cutSentences } from './sentences';

describe('cutSentences', () => {
  it('holds partial sentences until punctuation arrives', () => {
    expect(cutSentences('Hello the').sentences).toEqual([]);
    const r = cutSentences('Hello there. How are');
    expect(r.sentences).toEqual(['Hello there.']);
    expect(r.rest).toBe('How are');
  });

  it('cuts multiple sentences and newlines', () => {
    const r = cutSentences('One. Two! Three?\nFour');
    expect(r.sentences).toEqual(['One.', 'Two!', 'Three?']);
    expect(r.rest).toBe('Four');
  });

  it('does not split decimals', () => {
    const r = cutSentences('It costs 2.5 crores');
    expect(r.sentences).toEqual([]);
    expect(r.rest).toBe('It costs 2.5 crores');
  });

  it('force-cuts runaway text without punctuation', () => {
    const long = 'word '.repeat(60);
    const r = cutSentences(long);
    expect(r.sentences.length).toBeGreaterThan(0);
    expect(r.rest.length).toBeLessThanOrEqual(240);
  });

  it('keeps quoted sentence enders attached', () => {
    const r = cutSentences('She said "go now." Then left. ');
    expect(r.sentences[0]).toBe('She said "go now."');
    expect(r.sentences[1]).toBe('Then left.');
  });
});
