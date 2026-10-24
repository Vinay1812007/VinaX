/**
 * GET /api/ai/headlines: no job writes headlines, so there are never
 * stored headlines, so the answer is always the "nothing to show" shape, and
 * nothing is searched or fetched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('GET /api/ai/headlines', () => {
  it('answers { topics: [] }, cacheable, without any request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { onRequestGet } = await import('../functions/api/ai/headlines');
    const res = await onRequestGet();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=600');
    expect(await res.json()).toEqual({ topics: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
