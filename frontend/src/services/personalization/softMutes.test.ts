// @vitest-environment jsdom
/**
 * "Less like this" soft mutes: a mute is listed with its artist's name and
 * end date, Undo puts the profile back exactly (entry AND signal), unmute and
 * clear hand back what they removed so it can be restored, and expired
 * entries are never listed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';

vi.mock('@/services/storage/idb', () => ({ addEvent: vi.fn(async () => undefined), clearEvents: vi.fn(async () => undefined) }));

const DAY = 86_400_000;

const load = async () => {
  vi.resetModules();
  const storage = await import('./storage');
  const mutes = await import('./softMutes');
  return { ...storage, ...mutes };
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const sid = makeSong('s1', { title: 'సామజవరగమన', artist: 'సిద్ శ్రీరామ్' });
const arijit = makeSong('s2', { title: 'तुम ही हो', artist: 'अरिजीत सिंह', language: 'hindi' });

describe('soft mutes', () => {
  it('mutes the lead artist for the chosen number of days and lists it by name', async () => {
    const m = await load();
    const receipt = m.muteArtist(sid, 7);
    expect(receipt?.mute).toEqual({ key: sid.artists[0].id, name: 'సిద్ శ్రీరామ్', until: Date.now() + 7 * DAY });
    expect(m.listSoftMutes()).toEqual([receipt!.mute]);
    expect(m.isArtistSoftMuted(sid)).toBe(true);
    expect(m.daysLeft(receipt!.mute.until)).toBe(7);
  });

  it('Undo restores the profile exactly — the mute entry and the negative signal', async () => {
    const m = await load();
    m.withProfile((p) => {
      p.artists[sid.artists[0].id] = { score: 12, plays: 4, completes: 3, skips: 0, lastTs: 1, name: 'సిద్ శ్రీరామ్' };
      p.languages.telugu = { score: 20, plays: 9, completes: 7, skips: 1, lastTs: 1 };
      p.totals.skips = 3;
      return p;
    });
    const before = JSON.parse(JSON.stringify(m.loadProfile()));
    const receipt = m.muteArtist(sid, 14)!;
    const during = m.loadProfile();
    expect(during.artists[sid.artists[0].id].score).toBeLessThan(12);
    expect(during.totals.skips).toBe(4);
    receipt.undo();
    const after = m.loadProfile();
    expect(after.softMuted).toEqual(before.softMuted);
    expect(after.artists).toEqual(before.artists);
    expect(after.languages).toEqual(before.languages);
    expect(after.totals).toEqual(before.totals);
    expect(after.songs?.[sid.id]).toBeUndefined();
    // A second Undo is a no-op.
    receipt.undo();
    expect(m.listSoftMutes()).toEqual([]);
  });

  it('Undo of a re-mute puts the earlier mute back rather than deleting it', async () => {
    const m = await load();
    m.muteArtist(sid, 30);
    const first = m.listSoftMutes()[0];
    const second = m.muteArtist(sid, 7)!;
    expect(m.listSoftMutes()[0].until).toBe(Date.now() + 7 * DAY);
    second.undo();
    expect(m.listSoftMutes()).toEqual([first]);
  });

  it('unmute and clear hand back what they removed, and restore puts it back', async () => {
    const m = await load();
    m.muteArtist(sid, 7);
    m.muteArtist(arijit, 30);
    expect(m.listSoftMutes().map((x) => x.name)).toEqual(['సిద్ శ్రీరామ్', 'अरिजीत सिंह']);

    const removed = m.unmuteArtist(sid.artists[0].id)!;
    expect(removed.name).toBe('సిద్ శ్రీరామ్');
    expect(m.listSoftMutes().map((x) => x.name)).toEqual(['अरिजीत सिंह']);
    expect(m.unmuteArtist(sid.artists[0].id)).toBeNull();
    m.restoreSoftMutes([removed]);
    expect(m.listSoftMutes()).toHaveLength(2);

    const cleared = m.clearSoftMutes();
    expect(cleared).toHaveLength(2);
    expect(m.listSoftMutes()).toEqual([]);
    expect(m.clearSoftMutes()).toEqual([]);
    m.restoreSoftMutes(cleared);
    expect(m.listSoftMutes()).toEqual(cleared);
  });

  it('never lists an expired mute, and restore does not revive one that ended meanwhile', async () => {
    const m = await load();
    const r = m.muteArtist(sid, 7)!;
    vi.setSystemTime(Date.now() + 8 * DAY);
    expect(m.listSoftMutes()).toEqual([]);
    expect(m.isArtistSoftMuted(sid)).toBe(false);
    m.restoreSoftMutes([r.mute]);
    expect(m.listSoftMutes()).toEqual([]);
  });

  it('keys an id-less artist by lower-cased name, like the admission gate reads it', async () => {
    const m = await load();
    const noId = { ...sid, artists: [{ id: '', name: 'Ilaiyaraaja' }] };
    m.muteArtist(noId, 14);
    expect(m.loadProfile().softMuted).toHaveProperty('ilaiyaraaja');
    expect(m.listSoftMutes()[0].name).toBe('Ilaiyaraaja');
  });

  it('notifies subscribers on every change and clamps the expiry to a sane range', async () => {
    const m = await load();
    const seen = vi.fn();
    const off = m.subscribeSoftMutes(seen);
    const v0 = m.softMutesVersion();
    const r = m.muteArtist(sid, 9999)!;
    expect(r.mute.until).toBe(Date.now() + 90 * DAY);
    r.undo();
    m.muteArtist(sid, Number.NaN);
    expect(m.listSoftMutes()[0].until).toBe(Date.now() + 14 * DAY);
    expect(seen).toHaveBeenCalledTimes(3);
    expect(m.softMutesVersion()).toBe(v0 + 3);
    off();
    m.clearSoftMutes();
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it('a song without an artist cannot be muted', async () => {
    const m = await load();
    expect(m.muteArtist({ ...sid, artists: [] }, 7)).toBeNull();
  });
});
