import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '@/hooks/usePageTitle';
import { EntityHeader, EntityMeta, PlayFab } from '@/components/EntityHeader';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { SectionHeader } from '@/components/SectionHeader';
import { getSharedPlaylist, collabAdd, collabRemove, liteSong, SocialError } from '@/services/social/api';
import { resolveSongs } from '@/features/social/resolve';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { searchSongs } from '@/services/api/saavn';
import { currentAccount } from '@/services/auth/google';
import { getLocal } from '@/services/storage/local';
import { KEYS } from '@/constants/storage-keys';
import { FALLBACK_ART, bestImage } from '@/utils/images';
import { toast } from '@/store/toastStore';
import type { Song } from '@/types';
import '@/styles/pages/secondary.css';

/**
 * 15.0 — /p/<id>: a shared playlist's page. Anyone with the link plays it
 * and can save a copy; with the invite token (?token=…) they can add or
 * remove songs, no account needed. The owner sees it like a visitor would.
 * The server keeps names and artwork; the catalogue fills in the rest.
 */
export default function SharedPlaylistPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token');
  const q = useQuery({ queryKey: ['shared-playlist', id, token], queryFn: () => getSharedPlaylist(id, token), enabled: !!id, retry: false, staleTime: 30_000 });
  const playlist = q.data?.playlist;
  usePageTitle(playlist?.name ?? 'Shared playlist');
  const songsQ = useQuery({ queryKey: ['shared-playlist-songs', id, playlist?.version], queryFn: () => resolveSongs(playlist?.songs ?? [], 500), enabled: !!playlist?.songs.length, staleTime: 10 * 60_000 });
  const songs = songsQ.data ?? [];
  const canEdit = !!q.data?.canEdit && !!token;
  const createCollection = useLibraryStore((s) => s.createCollection);
  const addMany = useLibraryStore((s) => s.addManyToCollection);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Song[]>([]);
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <div className="vx-sec"><p className="text-ink-400 p-6">Loading…</p></div>;
  if (!playlist) {
    const err = q.error instanceof SocialError ? q.error.code : 'error';
    return <EmptyState title="This playlist is not here" message={err === 'not_found' ? 'The link is private, has been removed, or was mistyped.' : 'Could not load it right now.'} action={<Link to="/" className="vx-tap px-5 py-2.5 rounded-full btn-primary">Home</Link>} />;
  }

  const name = getLocal<string>(KEYS.userName, '') || currentAccount()?.user.name || 'A friend';
  const save = () => {
    const cid = createCollection(`${playlist.name}`);
    if (!cid) return;
    addMany(cid, songs);
    toast(`Saved “${playlist.name}” to your library`);
  };
  const search = async () => {
    const text = query.trim();
    if (!text) return;
    setBusy(true);
    try { setHits((await searchSongs(text, 8)).filter((s) => !playlist.songs.some((p) => p.id === s.id))); } catch { toast('Search is unavailable right now'); } finally { setBusy(false); }
  };
  const add = async (s: Song) => {
    if (!token) return;
    try {
      await collabAdd(id, token, liteSong(s), name);
      setHits((h) => h.filter((x) => x.id !== s.id));
      toast(`Added ${s.title}`);
      void q.refetch();
    } catch (e) {
      toast(e instanceof SocialError && e.code === 'too_large' ? 'The playlist is full' : 'Could not add it right now');
    }
  };
  const remove = async (s: Song) => {
    if (!token) return;
    try { await collabRemove(id, token, s.id); toast(`Removed ${s.title}`); void q.refetch(); } catch { toast('Could not remove it right now'); }
  };
  const cover = songs[0] ? bestImage(songs[0].images, 500) : playlist.songs[0]?.image ?? FALLBACK_ART;

  return (
    <div className="vx-sec is-wide">
      <EntityHeader
        kind="Shared playlist"
        title={playlist.name}
        titleText={playlist.name}
        art={<img src={cover} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-full h-full object-cover" />}
        artUrl={cover}
        description={playlist.description ?? undefined}
        meta={<EntityMeta items={[playlist.owner ? `by ${playlist.owner}` : null, `${playlist.songs.length} song${playlist.songs.length === 1 ? '' : 's'}`, canEdit ? 'You can add songs' : null]} />}
        actions={
          <>
            <PlayFab label="Play" onClick={() => usePlayerStore.getState().playQueue(songs, 0, { keepList: true })} disabled={!songs.length} />
            <button type="button" onClick={save} disabled={!songs.length} className="vx-tap px-5 min-h-[44px] rounded-full btn-secondary font-semibold">Save to my library</button>
          </>
        }
      />
      {canEdit && (
        <section className="vx-sec-block" aria-label="Add songs">
          <SectionHeader title="Add a song" explanation={`Added as ${name}`} />
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the catalogue" aria-label="Search songs" className="vx-set-input flex-1" />
            <button type="submit" disabled={busy} className="vx-tap px-4 min-h-[44px] rounded-full btn-primary font-semibold">Search</button>
          </form>
          {hits.length > 0 && (
            <ul className="vx-group mt-3">
              {hits.map((s) => (
                <li key={s.id} className="vx-row">
                  <img src={bestImage(s.images, 150)} alt="" className="w-10 h-10 rounded-md object-cover" />
                  <span className="vx-row-main"><span className="vx-row-label">{s.title}</span><span className="vx-row-hint">{s.subtitle}</span></span>
                  <button type="button" onClick={() => void add(s)} className="vx-tap px-4 min-h-[36px] rounded-full btn-secondary text-[13px] font-semibold">Add</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="vx-sec-block" aria-label="Songs">
        <SectionHeader title="Songs" explanation={songsQ.isLoading ? 'Looking the songs up…' : undefined} />
        <div className="vx-group">
          {songs.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0"><SongRow song={s} songs={songs} index={i} /></div>
              {canEdit && <button type="button" onClick={() => void remove(s)} aria-label={`Remove ${s.title}`} className="vx-tap px-3 min-h-[36px] rounded-full text-[13px] font-semibold text-ink-300">Remove</button>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
