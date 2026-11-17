// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';

vi.mock('@/services/account/sync', () => ({ scheduleSync: vi.fn() }));

import { inviteTokenFor, loadShareMap, mergeShareMaps, migrateShareTokens, readShareMap, sanitizeShareMap, saveInviteToken, saveShareLink, shareLinkFor } from './shareMap';

const ID = 'abcdefghij12';
const ID2 = 'zyxwvutsrq98';
const get = (k: string) => JSON.parse(localStorage.getItem(k) ?? 'null') as unknown;

describe('sanitizeShareMap', () => {
  it('keeps id, version, public and time, and never the invite token', () => {
    expect(sanitizeShareMap({ c1: { id: ID, token: 'secret', version: 3, public: true, at: 5, extra: 1 } })).toEqual({ c1: { id: ID, version: 3, public: true, at: 5 } });
  });

  it('drops entries with a bad shared id, and is null for something that is not a map', () => {
    expect(sanitizeShareMap({ c1: { id: 'NOT-AN-ID', version: 1 }, c2: 'x', c3: { id: ID2 } })).toEqual({ c3: { id: ID2, version: 0, at: 0 } });
    expect(sanitizeShareMap([1, 2])).toBeNull();
    expect(sanitizeShareMap('nope')).toBeNull();
  });

  it('forgets stop marks once they are half a year old', () => {
    const now = 400 * 86_400_000;
    const map = sanitizeShareMap({ old: { id: ID, version: 1, at: 1, off: true }, fresh: { id: ID2, version: 1, at: now - 1000, off: true } }, now);
    expect(Object.keys(map ?? {})).toEqual(['fresh']);
  });
});

describe('mergeShareMaps', () => {
  it('unions both sides and keeps the newer entry for the same playlist', () => {
    const merged = mergeShareMaps({ a: { id: ID, version: 2, at: 10 }, b: { id: ID2, version: 1, at: 10 } }, { a: { id: ID2, version: 7, at: 20 }, c: { id: ID, version: 1, at: 1 } });
    expect(merged.a).toEqual({ id: ID2, version: 7, at: 20 });
    expect(Object.keys(merged).sort()).toEqual(['a', 'b', 'c']);
  });

  it('a stop that is newer than the link wins, so a merge does not revive it', () => {
    expect(mergeShareMaps({ a: { id: ID, version: 2, at: 30, off: true } }, { a: { id: ID, version: 2, at: 10 } }).a.off).toBe(true);
    expect(mergeShareMaps({ a: { id: ID, version: 2, at: 10 } }, { a: { id: ID, version: 2, at: 30, off: true } }).a.off).toBe(true);
  });

  it('the version of one copy never goes back', () => {
    expect(mergeShareMaps({ a: { id: ID, version: 9, at: 10 } }, { a: { id: ID, version: 4, at: 20 } }).a).toEqual({ id: ID, version: 9, at: 20 });
  });
});

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('stopping a share leaves a mark that the live list hides', () => {
    const now = Date.now();
    saveShareLink('c1', { id: ID, version: 1, public: true }, now - 100);
    expect(shareLinkFor('c1')).toEqual({ id: ID, version: 1, public: true, at: now - 100 });
    saveShareLink('c1', null, now);
    expect(shareLinkFor('c1')).toBeNull();
    expect(loadShareMap()).toEqual({});
    expect(readShareMap().c1).toEqual({ id: ID, version: 1, at: now, off: true });
  });

  it('moves invite tokens an older build kept inside the map to the device-only key', () => {
    localStorage.setItem(KEYS.sharedPlaylists, JSON.stringify({ c1: { id: ID, token: 'tok', version: 2 } }));
    migrateShareTokens();
    expect(inviteTokenFor(ID)).toBe('tok');
    expect(get(KEYS.sharedPlaylists)).toEqual({ c1: { id: ID, version: 2 } });
    saveInviteToken(ID, null);
    expect(inviteTokenFor(ID)).toBeNull();
  });
});
