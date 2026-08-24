// @vitest-environment jsdom
/** Locks the client half of the playlist-variety fix (v3.3.1): the last ~60
 *  generated titles persist in localStorage and travel as avoidTitles[] on
 *  every request, successful generations feed the list (newest first, capped),
 *  and catalog resolution never collapses two suggestions onto the same
 *  search hit or the same catalog title. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));
vi.mock('@/services/ai/taste', () => ({ buildTasteSnapshot: () => ({}) }));
vi.mock('@/services/api', () => ({ searchSongs: vi.fn() }));

import { generatePlaylist, loadAvoidTitles, recordAvoidTitles, resolveSuggestions } from './playlist';
import { searchSongs } from '@/services/api';

const AVOID_KEY = 'vinax.aiplaylist.avoid.v1';

const song = (id: string, title: string): Song => ({ id, title, subtitle: 'A' }) as unknown as Song;

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(searchSongs).mockReset();
});

describe('avoid-title memory', () => {
  it('records newest first, dedupes case-insensitively and caps at 100', () => {
    // v3.7.1: cap bumped 60 → 100 so heavy users of AI Playlist don't exhaust
    // the anti-repeat memory in a couple of weeks.
    recordAvoidTitles(Array.from({ length: 95 }, (_, i) => `Old Song ${i}`));
    recordAvoidTitles(['Fresh One', 'FRESH ONE', 'Old Song 0', 'Fresh Two']);
    const list = loadAvoidTitles();
    expect(list).toHaveLength(97); // 95 + 2 new, dupes collapsed
    expect(list.slice(0, 3)).toEqual(['Fresh One', 'Old Song 0', 'Fresh Two']);
    recordAvoidTitles(Array.from({ length: 10 }, (_, i) => `Newer ${i}`));
    expect(loadAvoidTitles()).toHaveLength(100); // hard cap
    expect(loadAvoidTitles()[0]).toBe('Newer 0');
  });

  it('survives corrupt storage', () => {
    window.localStorage.setItem(AVOID_KEY, '{not json');
    expect(loadAvoidTitles()).toEqual([]);
  });
});

describe('generatePlaylist — avoid-list plumbing', () => {
  it('sends stored avoidTitles[] and records the new generation on success', async () => {
    recordAvoidTitles(['Previously Generated']);
    let sentBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
      sentBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: 'Mix',
          description: 'd',
          songs: [
            { title: 'Alpha', artist: 'X' },
            { title: 'Beta', artist: 'Y' },
          ],
        }),
      } as unknown as Response;
    });
    vi.mocked(searchSongs).mockImplementation(async (q: string) => [song(`id-${q}`, q)]);

    const res = await generatePlaylist('rainy vibes', [], []);
    vi.unstubAllGlobals();

    expect(res.ok).toBe(true);
    expect(sentBody.avoidTitles).toEqual(['Previously Generated']);
    // The new generation's titles now lead the memory for the NEXT request:
    // resolved catalog titles first (mock resolves "<title> <artist>" as the
    // catalog title), then the model's own titles, then the old memory.
    expect(loadAvoidTitles().slice(0, 5)).toEqual(['Alpha X', 'Beta Y', 'Alpha', 'Beta', 'Previously Generated']);
  });
});

describe('resolveSuggestions — no convergence on one search hit', () => {
  it('excludes already-picked ids and titles during resolution', async () => {
    const shared = song('dup-1', 'Same Hit');
    vi.mocked(searchSongs)
      .mockResolvedValueOnce([shared]) // suggestion 1 → top hit
      .mockResolvedValueOnce([shared, song('alt-2', 'Different Song')]) // suggestion 2 → same top hit + alternative
      .mockResolvedValueOnce([song('dup-1b', 'Same Hit'), song('alt-3', 'Third Song')]); // same title, new id

    const out = await resolveSuggestions(
      [
        { title: 'Same Hit', artist: 'A' },
        { title: 'Same Hit Reprise', artist: 'A' },
        { title: 'Same Hit Again', artist: 'A' },
      ],
      25,
      [],
    );
    expect(out.map((s) => s.id)).toEqual(['dup-1', 'alt-2', 'alt-3']);
  });

  it('prefers hits the recent generations have not used, falling back rather than dropping', async () => {
    vi.mocked(searchSongs)
      // Popularity-ranked: the avoided canonical hit first, a fresh one second.
      .mockResolvedValueOnce([song('pop-1', 'Canonical Hit'), song('new-1', 'Fresh Cut')])
      // Everything avoided → still resolves (soft preference, not a filter).
      .mockResolvedValueOnce([song('pop-2', 'Canonical Hit Two')]);

    const out = await resolveSuggestions(
      [
        { title: 'Query One', artist: 'A' },
        { title: 'Query Two', artist: 'B' },
      ],
      25,
      [],
      ['Canonical Hit', 'Canonical Hit Two'],
    );
    expect(out.map((s) => s.id)).toEqual(['new-1', 'pop-2']);
  });
});
