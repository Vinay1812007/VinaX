import { describe, expect, it } from 'vitest';
import type { BrowseCategory } from '@/services/api';
import { browseLanguage, browseLanguageChoices, categoryArt, categoryKind, categoryTone, groupCategories } from './useBrowse';

const cat = (id: string, name: string, category: string | null, over: Partial<BrowseCategory> = {}): BrowseCategory => ({
  id, name, category, tags: [], isNew: false, images: [], ...over,
});

describe('useBrowse helpers', () => {
  it('groups moods, then genres, then the rest, and drops the podcast shelf', () => {
    const groups = groupCategories([
      cat('17', 'Party', 'genre'),
      cat('27', 'Romance', 'mood'),
      cat('142', 'Podsnacks', 'music_plus'),
      cat('9', 'Weekend', 'occasion'),
      cat('29', 'Workout', 'mood'),
    ]);
    expect(groups.map((g) => [g.key, g.items.map((c) => c.name)])).toEqual([
      ['mood', ['Romance', 'Workout']],
      ['genre', ['Party']],
      ['more', ['Weekend']],
    ]);
  });

  it('leaves out empty groups', () => {
    expect(groupCategories([cat('1', 'Pop', 'genre')]).map((g) => g.key)).toEqual(['genre']);
    expect(groupCategories([])).toEqual([]);
  });

  it('wears a curated mood tone when the name matches, a steady one otherwise', () => {
    expect(categoryTone(cat('27', 'Romance', 'mood'))).toBe('vx-tone-3');
    expect(categoryTone(cat('17', 'Party', 'genre'))).toBe('vx-tone-9');
    const t = categoryTone(cat('37', 'Hip Hop', 'genre'));
    expect(t).toMatch(/^vx-tone-(\d|1[0-2])$/);
    expect(categoryTone(cat('37', 'Hip Hop', 'genre'))).toBe(t);
  });

  it('labels the kind', () => {
    expect(categoryKind({ category: 'mood' })).toBe('Mood');
    expect(categoryKind({ category: 'genre' })).toBe('Genre');
    expect(categoryKind({ category: null })).toBe('Category');
  });

  it('picks the first supported pinned language, hindi when none', () => {
    expect(browseLanguage(['telugu', 'tamil'])).toBe('telugu');
    expect(browseLanguage(['klingon'])).toBe('hindi');
    expect(browseLanguage([])).toBe('hindi');
  });

  it('offers pinned languages first, then the big ones, without repeats', () => {
    expect(browseLanguageChoices(['tamil', 'hindi'])).toEqual(['tamil', 'hindi', 'english', 'punjabi', 'telugu', 'bengali']);
    expect(browseLanguageChoices([])).toHaveLength(6);
  });

  it('has no art without images', () => {
    expect(categoryArt({ images: [] })).toBeNull();
    expect(categoryArt({ images: [{ quality: '150x150', url: 'https://c.saavncdn.com/x-150x150.jpg' }] })).toContain('saavncdn');
  });
});
