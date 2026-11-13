/**
 * 2.0 — song reactions are gone. Apps from before 2.0 still call the route:
 * reading gets an empty answer, leaving a reaction 410 Gone, and nothing
 * touches the database.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as reactions from '../functions/api/reactions';

afterEach(() => { vi.unstubAllGlobals(); });

describe('/api/reactions after 2.0', () => {
  it('answers an empty count without asking the database', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await reactions.onRequestGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 0, counts: {}, mine: null });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a new reaction with 410 Gone', async () => {
    const res = await reactions.onRequestPost();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'reactions_removed' });
    expect((await reactions.onRequestOptions()).status).toBe(204);
  });
});
