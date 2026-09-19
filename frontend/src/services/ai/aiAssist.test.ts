// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestCurator, resetCuratorBackoff } from './recommendations';
import { useSettingsStore } from '@/store/settingsStore';

/** 7.2.0 — with "AI in recommendations" off, no curate task reaches the network. */
afterEach(() => {
  vi.unstubAllGlobals();
  useSettingsStore.setState({ aiAssist: true });
  resetCuratorBackoff();
});

describe('the master switch gates every curate task', () => {
  it.each(['metadata', 'ranking', 'home', 'shelves'] as const)('%s sends nothing when off', async (task) => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { ids: [] } }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    useSettingsStore.setState({ aiAssist: false });
    expect(await requestCurator(task, { songs: [] })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('sends when on', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { ids: ['a'] } }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await requestCurator('ranking', { songs: [] })).toEqual({ ids: ['a'] });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
