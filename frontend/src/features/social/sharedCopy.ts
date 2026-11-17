/**
 * 1.15 — writing a local playlist's shared copy (/p/<id>), and keeping it in
 * step on its own.
 *
 * `pushSharedCopy` is the one write path, used by the Share sheet's buttons
 * and by the auto-push: it names the version it last saw, and a 409 (a friend
 * added songs, or another device wrote first) takes their additions into the
 * local playlist before writing again. `installSharedAutoPush` (started with
 * the account sync) pushes a shared playlist a few seconds after it changes
 * on this device; the sheet's "Update the shared copy" stays as the manual way.
 */
import { useLibraryStore, type LocalCollection } from '@/store/libraryStore';
import { currentAccount } from '@/services/auth/google';
import { isReadOnly } from '@/services/siteMode';
import { liteSong, listSharedPlaylists, writeSharedPlaylist, SocialError, type LiteSong, type SharedPlaylist } from '@/services/social/api';
import { toast } from '@/store/toastStore';
import type { Song } from '@/types';
import { saveInviteToken, saveShareLink, shareLinkFor, type ShareLink } from './shareMap';

export interface PushOptions {
  public?: boolean;
  /** true makes (or hands back) the invite link; false turns it off. */
  collab?: boolean;
  /** The copy as last read, so "added by" labels survive the write. Read from the server when left out. */
  remote?: SharedPlaylist | null;
  /** Skip the write when the copy already holds this name, description and song list. */
  onlyIfChanged?: boolean;
}

export type PushResult =
  | { ok: true; link: Omit<ShareLink, 'at'>; playlist: SharedPlaylist; token: string | null; merged: number; wrote: boolean }
  | { ok: false; reason: 'signed_out' | 'gone' | 'failed' };

/** What a write would change on the copy: the name, the description and the songs in order. */
export function sameAsCopy(c: Pick<LocalCollection, 'name' | 'description' | 'songs'>, p: Pick<SharedPlaylist, 'name' | 'description' | 'songs'>): boolean {
  if (c.name !== p.name || (c.description ?? null) !== (p.description ?? null) || c.songs.length !== p.songs.length) return false;
  return c.songs.every((s, i) => s.id === p.songs[i]?.id);
}

/** Songs on the copy that the local playlist does not have (a collaborator's additions). */
export function extraOnCopy(c: Pick<LocalCollection, 'songs'>, p: Pick<SharedPlaylist, 'songs'>): LiteSong[] {
  const have = new Set(c.songs.map((s) => s.id));
  return p.songs.filter((s) => !have.has(s.id));
}

/** Bring a collaborator's additions into the local playlist (full records from the catalogue). */
export async function takeInExtras(collectionId: string, extra: LiteSong[]): Promise<void> {
  if (!extra.length) return;
  const { resolveSongs } = await import('@/features/social/resolve');
  const full = await resolveSongs(extra, 100);
  if (full.length) useLibraryStore.getState().addManyToCollection(collectionId, full);
}

const findCopy = async (id: string): Promise<SharedPlaylist | null> => (await listSharedPlaylists()).find((p) => p.id === id) ?? null;

/** Write the shared copy of a local playlist (create it when there is none yet). */
export async function pushSharedCopy(collection: LocalCollection, opts: PushOptions = {}): Promise<PushResult> {
  if (!currentAccount()) return { ok: false, reason: 'signed_out' };
  const link = shareLinkFor(collection.id);
  try {
    let remote = opts.remote ?? null;
    if (link && !remote) {
      remote = await findCopy(link.id);
      if (!remote) {
        // Sharing was stopped elsewhere (or the copy was removed): forget the link.
        saveShareLink(collection.id, null);
        return { ok: false, reason: 'gone' };
      }
    }
    if (opts.onlyIfChanged && link && remote && opts.public === undefined && opts.collab === undefined && sameAsCopy(collection, remote)) {
      const next = { id: remote.id, version: remote.version, public: remote.public };
      if (next.version !== link.version || next.public !== link.public) saveShareLink(collection.id, next);
      return { ok: true, link: next, playlist: remote, token: null, merged: 0, wrote: false };
    }
    // 1.12 — "added by" stays on songs a collaborator put in, across the owner's own writes.
    const byOf = new Map((remote?.songs ?? []).filter((s) => s.by).map((s) => [s.id, s.by as string]));
    const lite = (s: Song) => {
      const l = liteSong(s);
      const by = byOf.get(s.id);
      return by ? { ...l, by } : l;
    };
    const body = {
      id: link?.id,
      name: collection.name,
      description: collection.description ?? null,
      songs: collection.songs.map(lite),
      // The version this account last wrote or merged, never the one just
      // read: when a friend added songs since, the server answers 409 and
      // the merge below keeps them. Naming the fresh version would let this
      // write silently drop their songs.
      version: link ? link.version : remote?.version,
      public: opts.public ?? remote?.public ?? link?.public ?? (link ? undefined : false),
      collab: opts.collab ?? remote?.collab,
    };
    let merged = 0;
    let r = await writeSharedPlaylist(body).catch((e: unknown) => {
      if (e instanceof SocialError && e.status === 409) return null;
      throw e;
    });
    if (!r && link) {
      // Someone wrote since this device last read: take their additions in, then write again.
      const theirs = await findCopy(link.id);
      if (theirs) {
        const extra = extraOnCopy(collection, theirs);
        merged = extra.length;
        r = await writeSharedPlaylist({ ...body, version: theirs.version, songs: [...collection.songs.map(lite), ...extra] });
        await takeInExtras(collection.id, extra).catch(() => undefined);
      }
    }
    if (!r) return { ok: false, reason: 'failed' };
    const next = { id: r.playlist.id, version: r.playlist.version, public: r.playlist.public };
    saveShareLink(collection.id, next);
    if (r.collabToken) saveInviteToken(next.id, r.collabToken);
    else if (opts.collab === false || !r.playlist.collab) saveInviteToken(next.id, null);
    return { ok: true, link: next, playlist: r.playlist, token: r.collabToken ?? null, merged, wrote: true };
  } catch (e) {
    if (e instanceof SocialError && e.code === 'signed_out') return { ok: false, reason: 'signed_out' };
    if (e instanceof SocialError && e.status === 404 && link) {
      saveShareLink(collection.id, null);
      return { ok: false, reason: 'gone' };
    }
    return { ok: false, reason: 'failed' };
  }
}

export const mergedNote = (n: number): string => `${n} song${n === 1 ? '' : 's'} added by collaborators came in`;

// ------------------------------------------------------------ auto push --
export const AUTO_PUSH_DELAY_MS = 5_000;
const print = (c: LocalCollection): string => `${c.name}\u0000${c.description ?? ''}\u0000${c.songs.map((s) => s.id).join(',')}`;

let installed: (() => void) | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Set<string>();
const again = new Set<string>();

function schedule(localId: string): void {
  const t = timers.get(localId);
  if (t) clearTimeout(t);
  timers.set(
    localId,
    setTimeout(() => {
      timers.delete(localId);
      void runAutoPush(localId);
    }, AUTO_PUSH_DELAY_MS),
  );
}

async function runAutoPush(localId: string): Promise<void> {
  if (running.has(localId)) {
    again.add(localId);
    return;
  }
  const c = useLibraryStore.getState().collections.find((x) => x.id === localId);
  if (!c || !currentAccount() || isReadOnly() || !shareLinkFor(localId)) return;
  running.add(localId);
  try {
    const r = await pushSharedCopy(c, { onlyIfChanged: true });
    if (r.ok && r.merged) toast(mergedNote(r.merged));
  } finally {
    running.delete(localId);
    if (again.delete(localId)) schedule(localId);
  }
}

/** Push a shared playlist's copy a few seconds after it changes here. Returns the uninstaller (tests). */
export function installSharedAutoPush(): () => void {
  if (installed) return installed;
  const off = useLibraryStore.subscribe((s, prev) => {
    if (s.collections === prev.collections) return;
    const before = new Map(prev.collections.map((c) => [c.id, c]));
    for (const c of s.collections) {
      const old = before.get(c.id);
      if (old === c || (old && print(old) === print(c))) continue;
      if (shareLinkFor(c.id)) schedule(c.id);
    }
  });
  installed = () => {
    off();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    running.clear();
    again.clear();
    installed = null;
  };
  return installed;
}
