/** Locks the manual-search-input fix (v3.6.0): the URL is only ever mirrored
 *  back into the box on a REAL external route change while the box is NOT
 *  focused — so typing is never overwritten (no snap-back, no hijack). */
import { describe, expect, it } from 'vitest';
import { shouldSyncRouteToInput } from './routeSync';

describe('shouldSyncRouteToInput', () => {
  it('NEVER syncs while the box is focused (the user is typing)', () => {
    // This is the snap-back guard: even a brand-new route value must not touch
    // the input mid-type.
    expect(shouldSyncRouteToInput('tum', null, true)).toBe(false);
    expect(shouldSyncRouteToInput('tum hi ho', 'tum', true)).toBe(false);
  });

  it('syncs a genuinely new route value when the box is NOT focused', () => {
    // deep link / back-forward / tapped chip while not typing.
    expect(shouldSyncRouteToInput('arijit singh', 'tum', false)).toBe(true);
    expect(shouldSyncRouteToInput('tum', null, false)).toBe(true);
  });

  it('does not re-apply a route value we already applied', () => {
    expect(shouldSyncRouteToInput('tum', 'tum', false)).toBe(false);
  });

  it('does nothing when there is no route query', () => {
    expect(shouldSyncRouteToInput(undefined, null, false)).toBe(false);
    expect(shouldSyncRouteToInput('', 'tum', false)).toBe(false);
  });
});
