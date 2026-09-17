import { afterEach, describe, expect, it } from 'vitest';
import { rewriteQuery, setSearchSynonyms } from './synonyms';

afterEach(() => setSearchSynonyms(null));

describe('rewriteQuery', () => {
  it('rewrites a whole query or a whole word, case-insensitively', () => {
    setSearchSynonyms({ arr: 'A. R. Rahman', dsp: 'Devi Sri Prasad' });
    expect(rewriteQuery('ARR')).toBe('A. R. Rahman');
    expect(rewriteQuery('dsp hits')).toBe('Devi Sri Prasad hits');
    expect(rewriteQuery('kesariya')).toBe('kesariya');
  });

  it('never resolves a word through the object prototype', () => {
    setSearchSynonyms({ arr: 'A. R. Rahman' });
    for (const q of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(rewriteQuery(q)).toBe(q);
      expect(rewriteQuery(`${q} songs`)).toBe(`${q} songs`);
    }
    expect(rewriteQuery('constructor arr')).toBe('constructor A. R. Rahman');
  });

  it('ignores published values that are not strings', () => {
    setSearchSynonyms({ arr: 42, dsp: 'Devi Sri Prasad' } as unknown as Record<string, string>);
    expect(rewriteQuery('arr')).toBe('arr');
    expect(rewriteQuery('arr dsp')).toBe('arr Devi Sri Prasad');
  });
});
