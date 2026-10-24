/**
 * GET /api/trends with no trend pipeline: no source, no item,
 * nothing fetched, and the answer still parses as the app's snapshot shape.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestOptions } from './trends';

afterEach(() => vi.unstubAllGlobals());

describe('GET /api/trends', () => {
  it('answers an empty snapshot, cacheable, without any request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await onRequestGet();
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { generatedAt: string; sources: unknown[]; items: unknown[] };
    expect(body.sources).toEqual([]);
    expect(body.items).toEqual([]);
    expect(Number.isFinite(Date.parse(body.generatedAt))).toBe(true);
    expect((await onRequestOptions()).status).toBe(204);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
