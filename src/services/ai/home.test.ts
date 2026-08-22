// @vitest-environment jsdom
/**
 * Locks the Home "always the same shelves" fix (v3.7.1): the client records
 * the shelves it just showed the listener in localStorage and hands them to
 * the server as `avoidShelves` on every subsequent request, so the AI is
 * steered away from re-serving them and the AI's variety promise finally has
 * cross-visit memory.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));

import { getAiHomeSections, recordShown } from './home';

const SHOWN_KEY = 'vinax.home.shown.v1';

beforeEach(() => {
  window.localStorage.clear();
});

describe('avoid-shelves memory', () => {
  it('records shown shelves newest first, dedupes by title, caps at 30', () => {
    // Fill with 25 dummies, then insert overlaps + new entries and verify
    // dedup + cap semantics.
    recordShown(
      Array.from({ length: 25 }, (_, i) => ({ title: `Shelf ${i}`, query: `q ${i}` })),
    );
    recordShown([
      { title: 'Fresh One', query: 'q new one' },
      { title: 'SHELF 0', query: 'q 0' }, // case-insensitive dupe of "Shelf 0"
      { title: 'Fresh Two', query: 'q new two' },
    ]);
    const stored = JSON.parse(window.localStorage.getItem(SHOWN_KEY) ?? '[]') as Array<{ title: string }>;
    expect(stored.length).toBe(27); // 25 + 2 fresh (dup collapsed)
    expect(stored[0].title).toBe('Fresh One');
    // Push enough to hit the cap.
    recordShown(Array.from({ length: 20 }, (_, i) => ({ title: `Newer ${i}`, query: `q newer ${i}` })));
    const after = JSON.parse(window.localStorage.getItem(SHOWN_KEY) ?? '[]') as Array<{ title: string }>;
    expect(after.length).toBe(30);
    expect(after[0].title).toBe('Newer 0');
  });

  it('is a no-op on empty input (never wipes existing state)', () => {
    recordShown([{ title: 'Kept', query: 'q kept' }]);
    recordShown([]);
    const stored = JSON.parse(window.localStorage.getItem(SHOWN_KEY) ?? '[]') as Array<{ title: string }>;
    expect(stored.length).toBe(1);
  });
});

describe('getAiHomeSections — avoidShelves plumbing', () => {
  it('sends stored avoidShelves in the body and records the response', async () => {
    recordShown([
      { title: 'Trending in Telugu', query: 'trending telugu songs 2026' },
      { title: 'A.R. Rahman deep cuts', query: 'ar rahman deep cuts' },
    ]);
    let sentBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
      sentBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return {
        ok: true,
        json: async () => ({
          sections: [
            { title: 'Fresh Punjabi energy', query: 'latest punjabi songs 2026' },
            { title: 'Late-night Tamil melodies', query: 'tamil late night melodies' },
          ],
        }),
      } as unknown as Response;
    });

    const sections = await getAiHomeSections({ preferredLanguages: ['telugu'] });

    // Client forwarded the recent shelves so the server can steer the model.
    const avoid = sentBody.avoidShelves as Array<{ title: string; query: string }>;
    expect(avoid).toHaveLength(2);
    // Order within a single recordShown batch preserves insertion order; the
    // dedup + newest-first semantics kick in across batches (verified in the
    // suite above).
    expect(avoid.map((s) => s.title)).toEqual([
      'Trending in Telugu',
      'A.R. Rahman deep cuts',
    ]);

    // Response was persisted so the NEXT build steers around it too.
    expect(sections).toHaveLength(2);
    const stored = JSON.parse(window.localStorage.getItem(SHOWN_KEY) ?? '[]') as Array<{ title: string }>;
    expect(stored[0].title).toBe('Fresh Punjabi energy');
    expect(stored[1].title).toBe('Late-night Tamil melodies');
    expect(stored.length).toBe(4);
  });

  it('returns [] and does not touch storage when the server errors', async () => {
    recordShown([{ title: 'Baseline', query: 'q baseline' }]);
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response);
    const sections = await getAiHomeSections({ preferredLanguages: ['hindi'] });
    expect(sections).toEqual([]);
    const stored = JSON.parse(window.localStorage.getItem(SHOWN_KEY) ?? '[]') as Array<{ title: string }>;
    expect(stored.length).toBe(1);
    expect(stored[0].title).toBe('Baseline');
  });
});
