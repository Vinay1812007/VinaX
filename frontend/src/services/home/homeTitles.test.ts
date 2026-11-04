// @vitest-environment jsdom
/** AI Home remembers the shelf titles it showed (newest first, at most 20) and sends them so the next layout uses fresh words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeContext } from '@/__fixtures__/songs';
import { buildHomeRequest, MAX_RECENT_TITLES, recentHomeTitles, rememberHomeTitles } from './homeBuilder';

beforeEach(() => localStorage.clear());

describe('recent Home titles', () => {
  it('keeps the newest first, without repeats, capped', () => {
    rememberHomeTitles(['Old one', 'Shared']);
    rememberHomeTitles(['New one', 'Shared']);
    expect(recentHomeTitles()).toEqual(['New one', 'Shared', 'Old one']);
    rememberHomeTitles(Array.from({ length: 30 }, (_, i) => `T${i}`));
    expect(recentHomeTitles()).toHaveLength(MAX_RECENT_TITLES);
  });

  it('goes out with the layout request', () => {
    rememberHomeTitles(['Rainy evening melodies']);
    const body = buildHomeRequest(makeContext(), { generation: 1, allowed: ['quick', 'personal', 'loved', 'feed'], avoid: [], seeds: [] });
    expect(body.recentTitles).toEqual(['Rainy evening melodies']);
  });
});
