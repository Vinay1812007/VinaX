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

describe('searchStore recents: one entry per search', () => {
  beforeEach(() => {
    useSearchStore.setState({ recent: [], pinned: [], songSort: 'relevance' });
  });

  it('folds case, spacing and Unicode composition when de-duplicating', () => {
    state().addRecent('Arijit Singh');
    state().addRecent('kesariya');
    state().addRecent('arijit   singh ');
    expect(state().recent).toEqual(['arijit   singh', 'kesariya']);
    state().addRecent('cafe\u0301'); // decomposed é
    state().addRecent('caf\u00e9'); // composed é
    expect(state().recent.filter((r) => r.normalize('NFC') === 'caf\u00e9')).toHaveLength(1);
  });

  it('a query typed in stages leaves one entry', () => {
    state().addRecent('kesariya');
    state().addRecent('arij');
    state().addRecent('arijit');
    state().addRecent('Arijit Singh');
    expect(state().recent).toEqual(['Arijit Singh', 'kesariya']);
  });

  it('only the newest entry is collapsed, and never a pinned one', () => {
    state().addRecent('arij');
    state().addRecent('kesariya');
    state().addRecent('arijit'); // "arij" is not the newest → it stays
    expect(state().recent).toEqual(['arijit', 'kesariya', 'arij']);

    state().pinRecent('arijit');
    state().addRecent('arijit singh');
    expect(state().recent).toEqual(['arijit singh', 'arijit', 'kesariya', 'arij']);
    expect(state().pinned).toEqual(['arijit']);
  });

  it('re-searching a pinned query in another spelling keeps the pin intact', () => {
    state().addRecent('Arijit');
    state().pinRecent('Arijit');
    state().addRecent('kesariya');
    state().addRecent('arijit');
    expect(state().recent).toEqual(['Arijit', 'kesariya']);
    expect(state().pinned).toEqual(['Arijit']);
  });

  it('rehydration folds duplicates an older blob already holds', async () => {
    window.localStorage.setItem(
      'vinax.search.v1',
      JSON.stringify({
        state: { recent: ['arijit', 'Kesariya', 'Arijit ', 'kesariya', 'ARIJIT'], pinned: ['ARIJIT', 'arijit'] },
        version: 0,
      }),
    );
    await useSearchStore.persist.rehydrate();
    expect(state().recent).toEqual(['ARIJIT', 'Kesariya']);
    expect(state().pinned).toEqual(['ARIJIT']);
  });
});
