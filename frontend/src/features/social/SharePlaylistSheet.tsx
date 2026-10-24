import { useEffect, useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import type { LocalCollection } from '@/store/libraryStore';
import { useLibraryStore } from '@/store/libraryStore';
import { currentAccount } from '@/services/auth/google';
import { liteSong, listSharedPlaylists, writeSharedPlaylist, deleteSharedPlaylist, SocialError, type SharedPlaylist } from '@/services/social/api';
import { shareLink } from '@/utils/share';
import { toast } from '@/store/toastStore';
import { getLocal, setLocal } from '@/services/storage/local';
import { KEYS } from '@/constants/storage-keys';
import { cn } from '@/utils/cn';

/**
 * 15.0 — Share a playlist: a public page anyone can open and play, and an
 * invite link that lets friends add songs (no account needed on their side).
 * The device remembers which shared copy belongs to which local playlist
 * (and the invite token, which the server returns once) in local storage;
 * "Update the shared copy" pushes the current songs, and a 409 (a friend
 * added something meanwhile) merges their additions into the local list
 * before pushing again.
 */

interface ShareLink { id: string; token?: string | null; version: number; public?: boolean }
type ShareMap = Record<string, ShareLink>;

export const loadShareMap = (): ShareMap => getLocal<ShareMap>(KEYS.sharedPlaylists, {});
export const saveShareLink = (localId: string, link: ShareLink | null): void => {
  const m = loadShareMap();
  if (link) m[localId] = link; else delete m[localId];
  setLocal(KEYS.sharedPlaylists, m);
};

export function SharePlaylistSheet({ collection, open, onClose }: { collection: LocalCollection; open: boolean; onClose: () => void }) {
  const [link, setLink] = useState<ShareLink | null>(() => loadShareMap()[collection.id] ?? null);
  const [remote, setRemote] = useState<SharedPlaylist | null>(null);
  const [busy, setBusy] = useState(false);
  const addMany = useLibraryStore((s) => s.addManyToCollection);

  useEffect(() => {
    if (!open || !link || !currentAccount()) return;
    void listSharedPlaylists().then((list) => setRemote(list.find((p) => p.id === link.id) ?? null)).catch(() => undefined);
  }, [open, link]);

  const push = async (opts: { public?: boolean; collab?: boolean } = {}) => {
    if (!currentAccount()) { toast('Sign in to share a playlist'); return; }
    setBusy(true);
    try {
      const body = { id: link?.id, name: collection.name, description: collection.description ?? null, songs: collection.songs.map(liteSong), version: link?.version, public: opts.public ?? remote?.public ?? link?.public ?? (link ? undefined : false), collab: opts.collab ?? remote?.collab };
      let r = await writeSharedPlaylist(body).catch(async (e: unknown) => {
        if (e instanceof SocialError && e.status === 409) return null;
        throw e;
      });
      if (!r && link) {
        // Someone added songs since this device last wrote: take theirs in, then write again.
        const fresh = await listSharedPlaylists();
        const theirs = fresh.find((p) => p.id === link.id);
        if (theirs) {
          const have = new Set(collection.songs.map((s) => s.id));
          const extra = theirs.songs.filter((s) => !have.has(s.id));
          if (extra.length) toast(`${extra.length} song${extra.length === 1 ? '' : 's'} added by collaborators came in`);
          r = await writeSharedPlaylist({ ...body, version: theirs.version, songs: [...collection.songs.map(liteSong), ...extra] });
          if (extra.length) {
            const { resolveSongs } = await import('@/features/social/resolve');
            const full = await resolveSongs(extra, 100);
            if (full.length) addMany(collection.id, full);
          }
        }
      }
      if (!r) throw new Error('conflict');
      const next: ShareLink = { id: r.playlist.id, token: r.collabToken ?? (opts.collab === false ? null : link?.token ?? null), version: r.playlist.version, public: r.playlist.public };
      setLink(next);
      saveShareLink(collection.id, next);
      setRemote(r.playlist);
      toast(link ? 'Shared copy updated' : 'Playlist shared');
    } catch (e) {
      toast(e instanceof SocialError && e.code === 'signed_out' ? 'Sign in to share a playlist' : 'Could not share right now');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!link) return;
    setBusy(true);
    try {
      await deleteSharedPlaylist(link.id);
      saveShareLink(collection.id, null);
      setLink(null);
      setRemote(null);
      toast('Sharing stopped — the link no longer works');
    } catch {
      toast('Could not stop sharing right now');
    } finally {
      setBusy(false);
    }
  };

  const pagePath = link ? `/p/${link.id}` : null;
  const invitePath = link?.token ? `/p/${link.id}?token=${link.token}` : null;

  return (
    <Sheet open={open} onClose={onClose} labelledBy="vx-share-pl-title" size="md" className="vx-np-opts">
      <SheetHeader id="vx-share-pl-title" title="Share this playlist" subtitle={link ? `Shared · ${remote?.songs.length ?? collection.songs.length} songs on the page` : 'Nobody can see it yet'} onClose={onClose} />
      {!link ? (
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Make a page</span>
          <div className="vx-np-opt-controls">
            <button type="button" className="vx-np-pill is-on" disabled={busy || !collection.songs.length} onClick={() => void push({ public: true })}>Share as a public page</button>
            <button type="button" className="vx-np-pill" disabled={busy || !collection.songs.length} onClick={() => void push({ public: false, collab: true })}>Invite friends to add songs</button>
          </div>
          <p className="mt-2 text-[13px] text-ink-400">A page carries the songs' names and artwork. A public page is open to anyone with the link; an invite link lets friends add songs without an account.</p>
        </div>
      ) : (
        <>
          <div className="vx-np-opt">
            <span className="vx-np-opt-label">Public page</span>
            <div className="vx-np-opt-controls">
              <button type="button" className={cn('vx-np-pill', remote?.public && 'is-on')} aria-pressed={!!remote?.public} disabled={busy} onClick={() => void push({ public: !remote?.public })}>{remote?.public ? 'Public' : 'Private'}</button>
              {pagePath && <button type="button" className="vx-np-pill" onClick={() => void shareLink(pagePath, collection.name).then((r) => r === 'copied' && toast('Link copied'))}>Copy the link</button>}
            </div>
          </div>
          <div className="vx-np-opt">
            <span className="vx-np-opt-label">Collaborators</span>
            <div className="vx-np-opt-controls">
              <button type="button" className={cn('vx-np-pill', remote?.collab && 'is-on')} aria-pressed={!!remote?.collab} disabled={busy} onClick={() => void push({ collab: !remote?.collab })}>{remote?.collab ? 'Invites on' : 'Invites off'}</button>
              {invitePath && <button type="button" className="vx-np-pill" onClick={() => void shareLink(invitePath, `Add songs to ${collection.name}`).then((r) => r === 'copied' && toast('Invite link copied'))}>Copy the invite link</button>}
            </div>
            {remote?.collab && !invitePath && <p className="mt-2 text-[13px] text-ink-400">The invite link was made on another device. Switch invites off and on to make a new one.</p>}
          </div>
          <div className="vx-np-opt">
            <span className="vx-np-opt-label">Keep in step</span>
            <div className="vx-np-opt-controls">
              <button type="button" className="vx-np-pill" disabled={busy} onClick={() => void push()}>Update the shared copy</button>
              <button type="button" className="vx-np-pill is-quiet" disabled={busy} onClick={() => void stop()}>Stop sharing</button>
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}
