import { useEffect, useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import type { LocalCollection } from '@/store/libraryStore';
import { currentAccount } from '@/services/auth/google';
import { listSharedPlaylists, deleteSharedPlaylist, type SharedPlaylist } from '@/services/social/api';
import { shareLink } from '@/utils/share';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { inviteTokenFor, loadShareMap, saveInviteToken, saveShareLink, shareLinkFor, type ShareLink } from './shareMap';
import { extraOnCopy, mergedNote, pushSharedCopy, takeInExtras } from './sharedCopy';

/**
 * 15.0 — Share a playlist: a public page anyone can open and play, and an
 * invite link that lets friends add songs (no account needed on their side).
 * 1.15 — which shared copy belongs to which local playlist follows the
 * account and the backup (./shareMap); the invite token stays on the device
 * and the server hands it back when it is missing. The copy updates itself a
 * few seconds after the playlist changes (./sharedCopy); "Update the shared
 * copy" is the manual way. On a device that does not know the link yet, a
 * copy with the same name can be linked again.
 */
type Link = Omit<ShareLink, 'at'>;

export function SharePlaylistSheet({ collection, open, onClose }: { collection: LocalCollection; open: boolean; onClose: () => void }) {
  const [link, setLink] = useState<Link | null>(() => shareLinkFor(collection.id));
  const [token, setToken] = useState<string | null>(() => (link ? inviteTokenFor(link.id) : null));
  const [remote, setRemote] = useState<SharedPlaylist | null>(null);
  const [match, setMatch] = useState<SharedPlaylist | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !currentAccount()) return;
    // Re-read: a sync or the auto-push may have changed the link since the sheet was made.
    const fresh = shareLinkFor(collection.id);
    if (fresh?.id !== link?.id || fresh?.version !== link?.version) {
      setLink(fresh);
      setToken(fresh ? inviteTokenFor(fresh.id) : null);
      return;
    }
    let live = true;
    void listSharedPlaylists()
      .then((list) => {
        if (!live) return;
        if (link) {
          setRemote(list.find((p) => p.id === link.id) ?? null);
          return;
        }
        // Not linked on this device: offer a copy with the same name that no other playlist claims.
        const taken = new Set(Object.values(loadShareMap()).map((l) => l.id));
        const name = collection.name.trim().toLowerCase();
        setMatch(list.find((p) => !taken.has(p.id) && p.name.trim().toLowerCase() === name) ?? null);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [open, link, collection.id, collection.name]);

  const push = async (opts: { public?: boolean; collab?: boolean } = {}, done?: string) => {
    if (!currentAccount()) { toast('Sign in to share a playlist'); return; }
    setBusy(true);
    try {
      const r = await pushSharedCopy(collection, { ...opts, remote });
      if (!r.ok) {
        if (r.reason === 'gone') {
          setLink(null);
          setRemote(null);
          setToken(null);
          toast('This playlist is no longer shared. Share it again to make a new link.');
        } else toast(r.reason === 'signed_out' ? 'Sign in to share a playlist' : 'Could not share right now');
        return;
      }
      if (r.merged) toast(mergedNote(r.merged));
      setLink(r.link);
      setRemote(r.playlist);
      setToken(r.playlist.collab ? r.token ?? inviteTokenFor(r.link.id) : null);
      toast(done ?? (link ? 'Shared copy updated' : 'Playlist shared'));
    } finally {
      setBusy(false);
    }
  };

  const relink = async (p: SharedPlaylist) => {
    setBusy(true);
    try {
      const next = { id: p.id, version: p.version, public: p.public };
      saveShareLink(collection.id, next);
      setMatch(null);
      setRemote(p);
      setLink(next);
      setToken(inviteTokenFor(p.id));
      // Songs friends added there come into this playlist, so the next write keeps them.
      const extra = extraOnCopy(collection, p);
      if (extra.length) {
        toast(mergedNote(extra.length));
        await takeInExtras(collection.id, extra).catch(() => undefined);
      } else toast('Linked to your shared copy');
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
      saveInviteToken(link.id, null);
      setLink(null);
      setRemote(null);
      setToken(null);
      toast('Sharing stopped — the link no longer works');
    } catch {
      toast('Could not stop sharing right now');
    } finally {
      setBusy(false);
    }
  };

  const pagePath = link ? `/p/${link.id}` : null;
  const invitePath = link && token ? `/p/${link.id}?token=${token}` : null;

  return (
    <Sheet open={open} onClose={onClose} labelledBy="vx-share-pl-title" size="md" className="vx-np-opts">
      <SheetHeader id="vx-share-pl-title" title="Share this playlist" subtitle={link ? `Shared · ${remote?.songs.length ?? collection.songs.length} songs on the page` : 'Nobody can see it yet'} onClose={onClose} />
      {!link ? (
        <>
          {match && (
            <div className="vx-np-opt">
              <span className="vx-np-opt-label">Shared before</span>
              <div className="vx-np-opt-controls">
                <button type="button" className="vx-np-pill is-on" disabled={busy} onClick={() => void relink(match)}>Use the link you made before</button>
              </div>
              <p className="mt-2 text-[13px] text-ink-400">You already have a shared copy called “{match.name}” with {match.songs.length} songs. Using it keeps its link working.</p>
            </div>
          )}
          <div className="vx-np-opt">
            <span className="vx-np-opt-label">Make a page</span>
            <div className="vx-np-opt-controls">
              <button type="button" className={cn('vx-np-pill', !match && 'is-on')} disabled={busy || !collection.songs.length} onClick={() => void push({ public: true })}>Share as a public page</button>
              <button type="button" className="vx-np-pill" disabled={busy || !collection.songs.length} onClick={() => void push({ public: false, collab: true })}>Invite friends to add songs</button>
            </div>
            <p className="mt-2 text-[13px] text-ink-400">A page carries the songs' names and artwork. A public page is open to anyone with the link; an invite link lets friends add songs without an account.</p>
          </div>
        </>
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
              {remote?.collab && !invitePath && <button type="button" className="vx-np-pill" disabled={busy} onClick={() => void push({ collab: true }, 'Invite link ready')}>Get the invite link</button>}
            </div>
          </div>
          <div className="vx-np-opt">
            <span className="vx-np-opt-label">Keep in step</span>
            <div className="vx-np-opt-controls">
              <button type="button" className="vx-np-pill" disabled={busy} onClick={() => void push()}>Update the shared copy</button>
              <button type="button" className="vx-np-pill is-quiet" disabled={busy} onClick={() => void stop()}>Stop sharing</button>
            </div>
            <p className="mt-2 text-[13px] text-ink-400">Changes to this playlist reach the shared copy by themselves a few seconds later.</p>
          </div>
        </>
      )}
    </Sheet>
  );
}
