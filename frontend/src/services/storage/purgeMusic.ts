/**
 * The second half of the one-time purge of every song saved on this device.
 *
 * VinaX no longer has a music provider. The first half is an inline script at
 * the top of index.html: it forgets the saved songs in localStorage (Library,
 * history, queue, bookmarks, karaoke, weekly mix, release alerts, shared-
 * playlist links, and any other VinaX key holding a song) before any app code
 * runs, and leaves FILES_PENDING_KEY behind. It has to be a classic inline
 * script: the bundler evaluates this module's chunk after the chunks it
 * imports, and those create the stores that would load the songs first.
 *
 * This half deletes what localStorage cannot: downloaded audio (the Cache API
 * bucket and, on Android, the files), listening events and song embeddings.
 * Best effort, in the background; account sync no longer carries the song
 * categories (services/account/sync.ts), so nothing pulls them back.
 */

export const MUSIC_PURGED_KEY = 'vinax.music-purged.v1';
export const FILES_PENDING_KEY = 'vinax.music-purge-files.v1';

/** Downloads, listening events and song embeddings. */
export async function purgeStoredAudio(): Promise<void> {
  const jobs: Array<Promise<unknown>> = [];
  if (typeof caches !== 'undefined') jobs.push(caches.delete('vinax-audio-v1'));
  if (typeof indexedDB !== 'undefined') {
    jobs.push(import('./idb').then((m) => m.clearEvents()));
    jobs.push(
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('vinax-embeddings');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
    );
  }
  jobs.push(
    import('@capacitor/core').then(async ({ Capacitor }) => {
      if (!Capacitor.isNativePlatform()) return;
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      for (const directory of [Directory.Data, Directory.External]) {
        await Filesystem.rmdir({ path: 'vinax-downloads', directory, recursive: true }).catch(() => undefined);
      }
    }),
  );
  await Promise.allSettled(jobs);
}

try {
  if (typeof window !== 'undefined' && window.localStorage.getItem(FILES_PENDING_KEY) !== null) {
    void purgeStoredAudio()
      .then(() => window.localStorage.removeItem(FILES_PENDING_KEY))
      .catch(() => undefined);
  }
} catch {
  // Private mode / storage unavailable — nothing saved to purge.
}
