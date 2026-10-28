/**
 * The one-time purge of saved songs. Its localStorage half is the inline
 * script at the top of index.html (it must run before any app code), so this
 * test runs that very script: song keys and any VinaX key carrying a song go,
 * everything else (settings, account, identity) stays, and it runs once.
 *
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { FILES_PENDING_KEY, MUSIC_PURGED_KEY } from './purgeMusic';
import { SYNC_CATEGORIES } from '@/services/account/sync';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');
const purgeScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes(MUSIC_PURGED_KEY));
const runPurge = (): void => {
  new Function(purgeScript ?? 'throw new Error("no purge script in index.html")')();
};

const song = { kind: 'song', id: 's1', title: 'A song', audio: [{ quality: '160kbps', url: '/api/cat/stream?e=x' }] };

beforeEach(() => window.localStorage.clear());

describe('the purge script in index.html', () => {
  it('is the first script in the page, so it runs before the app loads saved songs', () => {
    const first = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    expect(first?.[1]).toContain(MUSIC_PURGED_KEY);
  });

  it('removes the song stores and any VinaX key holding a song, and keeps the rest', () => {
    const ls = window.localStorage;
    ls.setItem(KEYS.library, JSON.stringify({ state: { favorites: [song], playlists: [] } }));
    ls.setItem(KEYS.history, JSON.stringify({ state: { entries: [] } }));
    ls.setItem(KEYS.player, JSON.stringify({ state: { queue: [song] } }));
    ls.setItem(KEYS.downloads, '{}');
    ls.setItem('vinax.some-feature.v1', JSON.stringify({ pick: song }));
    ls.setItem('vinax.cover.v1', JSON.stringify({ url: 'https://c.saavncdn.com/x.jpg' }));
    ls.setItem(KEYS.settings, JSON.stringify({ state: { theme: 'dark' } }));
    ls.setItem(KEYS.account, JSON.stringify({ session: 's' }));
    ls.setItem(KEYS.userName, '"Asha"');
    ls.setItem('other.app', JSON.stringify(song));

    runPurge();

    for (const gone of [KEYS.library, KEYS.history, KEYS.player, KEYS.downloads, 'vinax.some-feature.v1', 'vinax.cover.v1']) {
      expect(ls.getItem(gone), gone).toBeNull();
    }
    for (const kept of [KEYS.settings, KEYS.account, KEYS.userName, 'other.app']) {
      expect(ls.getItem(kept), kept).not.toBeNull();
    }
    expect(ls.getItem(MUSIC_PURGED_KEY)).not.toBeNull();
    expect(ls.getItem(FILES_PENDING_KEY)).toBe('1');
  });

  it('names the stores by their real keys', () => {
    for (const k of [KEYS.player, KEYS.queueOwnership, KEYS.library, KEYS.history, KEYS.downloads, KEYS.smartDownloads, KEYS.weekly, KEYS.karaoke, KEYS.releases, KEYS.sharedPlaylists]) {
      expect(purgeScript, k).toContain(`'${k}'`);
    }
  });

  it('runs once: songs saved after the purge are left alone', () => {
    const ls = window.localStorage;
    runPurge();
    ls.setItem(KEYS.library, JSON.stringify({ state: { favorites: [song] } }));
    runPurge();
    expect(ls.getItem(KEYS.library)).not.toBeNull();
  });
});

describe('account sync', () => {
  it('no longer carries the categories that hold songs', () => {
    for (const c of ['library', 'history', 'bookmarks']) expect(SYNC_CATEGORIES).not.toContain(c);
  });
});
