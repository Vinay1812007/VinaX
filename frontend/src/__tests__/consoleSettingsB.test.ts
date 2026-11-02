/**
 * v8 — what the app does with App Settings › Search & Music Sources and
 * Maintenance: the owner's source priority, and the shared read-only state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeBases, API_BASES, setDisabledSources, setSourceOrder } from '@/constants/endpoints';
import { getSiteMode, isReadOnly, onSiteMode, setSiteMode } from '@/services/siteMode';
import { sendFeedback } from '@/services/feedback';

afterEach(() => {
  setSourceOrder([]);
  setDisabledSources([]);
  setSiteMode('live');
  vi.unstubAllGlobals();
});

describe('music source priority', () => {
  it('keeps the built-in order until the owner ranks the sources', () => {
    expect(activeBases().map((b) => b.id)).toEqual(API_BASES.map((b) => b.id));
  });
  it('tries the owner’s first choice first, ignoring unknown ids', () => {
    const ids = API_BASES.map((b) => b.id);
    setSourceOrder(['nope', ...[...ids].reverse()]);
    expect(activeBases().map((b) => b.id)).toEqual([...ids].reverse());
  });
  it('a switched-off source stays off whatever the order', () => {
    const ids = API_BASES.map((b) => b.id);
    if (ids.length < 2) return;
    setSourceOrder([...ids].reverse());
    setDisabledSources([ids[0]]);
    expect(activeBases().map((b) => b.id)).toEqual(ids.slice(1).reverse());
  });
});

describe('read-only mode', () => {
  it('tracks the mode and tells listeners once per change', () => {
    const seen: string[] = [];
    const off = onSiteMode((m) => seen.push(m));
    setSiteMode('readonly');
    setSiteMode('readonly');
    setSiteMode('something-else');
    off();
    setSiteMode('maintenance');
    expect(seen).toEqual(['readonly', 'live']);
    expect(getSiteMode()).toBe('maintenance');
  });
  it('feedback is not sent while read-only', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    setSiteMode('readonly');
    expect(isReadOnly()).toBe(true);
    expect(await sendFeedback('bug', 'hello')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
