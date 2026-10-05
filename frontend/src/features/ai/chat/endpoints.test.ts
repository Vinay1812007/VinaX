import { afterEach, describe, expect, it, vi } from 'vitest';
import { warmWebSearch } from './endpoints';

afterEach(() => vi.unstubAllGlobals());

describe('warmWebSearch (10.1)', () => {
  it('wakes the search engine once, then waits two minutes before asking again', () => {
    const f = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', f);
    const t0 = 10_000_000;
    warmWebSearch(t0);
    warmWebSearch(t0 + 30_000);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]).toEqual(['/api/warm-search', { method: 'POST', keepalive: true }]);
    warmWebSearch(t0 + 121_000);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
