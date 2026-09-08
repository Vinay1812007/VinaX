import { describe, expect, it } from 'vitest';
import { exampleQueries } from './searchTips';

describe('exampleQueries', () => {
  it('builds three chips around the pinned languages, wrapping around', () => {
    expect(exampleQueries(['telugu'])).toEqual(['Telugu love songs', 'Telugu 90s hits', 'rainy evening Telugu melodies']);
    expect(exampleQueries(['telugu', 'hindi'])).toEqual(['Telugu love songs', 'Hindi 90s hits', 'rainy evening Telugu melodies']);
  });

  it('stays language-free when nothing is pinned', () => {
    expect(exampleQueries([])).toEqual(['love songs', '90s hits', 'rainy evening melodies']);
  });
});
