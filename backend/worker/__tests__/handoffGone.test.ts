/**
 * Move to a new device was retired: /api/handoff stores and reads nothing and
 * answers a readable 410 so installed apps from before the removal fail soft.
 */
import { describe, expect, it } from 'vitest';
import { onRequestGet, onRequestOptions, onRequestPost } from '../functions/api/handoff';

describe('/api/handoff (retired)', () => {
  it('answers 410 gone to GET and POST, readable cross-origin', async () => {
    for (const res of [await onRequestGet(), await onRequestPost()]) {
      expect(res.status).toBe(410);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(await res.json()).toEqual({ error: 'gone' });
    }
  });

  it('still answers the preflight, so the app can read the 410', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
