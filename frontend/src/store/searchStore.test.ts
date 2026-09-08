// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useSearchStore } from './searchStore';

const state = () => useSearchStore.getState();

describe('searchStore (v5.17.0 recents: pin, remove, clear, sort)', () => {
  beforeEach(() => {
    useSearchStore.setState({ recent: [], pinned: [], songSort: 'relevance' });
  });

  it('adds recents most-recent-first and de-duplicates', () => {
    state().addRecent('tum hi ho');
    state().addRecent('kesariya');
    state().addRecent('tum hi ho');
    expect(state().recent).toEqual(['tum hi ho', 'kesariya']);
  });

  it('pins at most 5, and a pinned query is never pushed out by new recents', () => {
    for (let i = 0; i < 6; i += 1) state().pinRecent(`pin ${i}`);
    expect(state().pinned).toHaveLength(5);
    expect(state().pinned).not.toContain('pin 5');
    for (let i = 0; i < 20; i += 1) state().addRecent(`q ${i}`);
    for (const p of state().pinned) expect(state().recent).toContain(p);
    expect(state().recent.filter((r) => !state().pinned.includes(r))).toHaveLength(12);
  });

  it('togglePin flips a pin; removeRecent also unpins', () => {
    state().addRecent('arijit');
    state().togglePin('arijit');
    expect(state().pinned).toEqual(['arijit']);
    state().togglePin('arijit');
    expect(state().pinned).toEqual([]);
    state().togglePin('arijit');
    state().removeRecent('arijit');
    expect(state().recent).toEqual([]);
    expect(state().pinned).toEqual([]);
  });

  it('clearRecent keeps the pinned ones', () => {
    state().addRecent('one');
    state().addRecent('two');
    state().pinRecent('two');
    state().clearRecent();
    expect(state().recent).toEqual(['two']);
    expect(state().pinned).toEqual(['two']);
  });

  it('persists the Songs-tab sort and rejects junk', () => {
    state().setSongSort('newest');
    expect(state().songSort).toBe('newest');
    state().setSongSort('bogus' as never);
    expect(state().songSort).toBe('relevance');
  });
});

describe('searchStore rehydration', () => {
  it('fills safe defaults when an older blob lacks pinned / songSort', async () => {
    window.localStorage.setItem(
      'vinax.search.v1',
      JSON.stringify({ state: { recent: ['old one', 42, 'old two'] }, version: 0 }),
    );
    await useSearchStore.persist.rehydrate();
    expect(state().recent).toEqual(['old one', 'old two']);
    expect(state().pinned).toEqual([]);
    expect(state().songSort).toBe('relevance');
  });
});
