import { useCallback, useEffect, useRef, useState } from 'react';
import { SongRow } from '@/components/SongRow';
import { SectionHeader } from '@/components/SectionHeader';
import { useLibraryStore, type LocalCollection } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { toast, toastNavigate } from '@/store/toastStore';
import { relativeTime } from '@/utils/format';
import type { PublicProfile } from '@/services/social/api';
import { blendFor, buildBlend, needsRefresh, saveBlend, theirsKey, useBlendStore, type BlendRecord, type BlendSource } from '@/features/social/blend';

/** How many of the blend's songs the profile page lists. */
const SHOWN = 12;

export interface BlendState {
  rec: BlendRecord | null;
  playlist: LocalCollection | undefined;
  busy: boolean;
  /** Make the blend (and play it), or rebuild it. */
  run(mode: 'create' | 'refresh'): Promise<void>;
}

/**
 * The blend with this profile's listener: the saved playlist, if any, and a
 * way to make or rebuild it. When the page opens, a blend whose sides changed
 * (their recent likes, or your newest likes) is rebuilt quietly, once. A like
 * you make while the page is open waits for the next visit (or Refresh), so
 * liking songs here does not rebuild the playlist each time.
 */
export function useBlend(profile: PublicProfile | undefined, enabled: boolean): BlendState {
  const favorites = useLibraryStore((s) => s.favorites);
  const collections = useLibraryStore((s) => s.collections);
  const blends = useBlendStore((s) => s.blends);
  const rec = profile ? blendFor(profile.handle, blends, collections) : null;
  const playlist = rec ? collections.find((c) => c.id === rec.collectionId) : undefined;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const autoTried = useRef('');

  const build = useCallback(async (mode: 'create' | 'refresh' | 'auto') => {
    if (!profile || busyRef.current) return;
    const who = profile.name ?? profile.handle;
    const favs = useLibraryStore.getState().favorites;
    const theirLikes = Array.isArray(profile.recentLikes) ? profile.recentLikes : [];
    if (!theirLikes.length && !favs.length) {
      if (mode !== 'auto') toast('Nothing to blend from yet');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await buildBlend(theirLikes, favs);
      if (!result.songs.length) {
        if (mode !== 'auto') toast('Could not build the blend right now');
        return;
      }
      const saved = saveBlend(profile, result, favs);
      if (mode === 'create') {
        const list = saved ? useLibraryStore.getState().collections.find((c) => c.id === saved.collectionId) : undefined;
        usePlayerStore.getState().playQueue(list?.songs.length ? list.songs : result.songs, 0, list ? { from: blendContext(list) } : {});
        toast(saved ? `Saved Blend with ${who}: ${result.songs.length} songs` : `Blend with ${who}: ${result.songs.length} songs`, saved ? { action: { label: 'Open', onClick: () => toastNavigate(`/collection/${saved.collectionId}`) } } : undefined);
      } else if (mode === 'refresh') {
        toast(`Blend with ${who} refreshed`);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [profile]);

  useEffect(() => {
    if (!enabled || !profile || !rec) return;
    // Looked at once per profile visit, and again only if their likes change while it is open.
    const key = `${profile.handle}|${theirsKey(profile.recentLikes)}`;
    if (autoTried.current === key) return;
    autoTried.current = key;
    if (needsRefresh(rec, profile, favorites)) void build('auto');
  }, [enabled, profile, rec, favorites, build]);

  return { rec, playlist, busy, run: build };
}

/** "Playing from" the blend playlist. */
const blendContext = (playlist: LocalCollection | undefined) => (playlist ? { kind: 'playlist' as const, label: playlist.name, path: `/collection/${playlist.id}` } : null);

/** The header button: Blend (make it, save it, play it), or Play blend once it exists. */
export function BlendButton({ blend }: { blend: BlendState }) {
  const songs = blend.playlist?.songs ?? [];
  if (blend.rec && songs.length) {
    return (
      <button type="button" onClick={() => usePlayerStore.getState().playQueue(songs, 0, { from: blendContext(blend.playlist) })} className="vx-tap px-5 min-h-[44px] rounded-full btn-secondary font-semibold">
        Play blend
      </button>
    );
  }
  return (
    <button type="button" onClick={() => void blend.run('create')} disabled={blend.busy} className="vx-tap px-5 min-h-[44px] rounded-full btn-secondary font-semibold" title="A playlist from both of your likes, built on this device">
      {blend.busy ? 'Blending…' : 'Blend'}
    </button>
  );
}

const sourceLabel = (src: BlendSource | undefined, who: string): string => (src === 'both' ? 'Both of you' : src === 'theirs' ? `From ${who}` : src === 'mine' ? 'From you' : 'Added by you');

/** The saved blend on the profile page: its songs, whose likes each came from, and Refresh. */
export function BlendSection({ blend, profile }: { blend: BlendState; profile: PublicProfile }) {
  const { rec, playlist } = blend;
  if (!rec || !playlist) return null;
  const who = profile.name ?? profile.handle;
  const songs = playlist.songs.slice(0, SHOWN);
  return (
    <section className="vx-sec-block" aria-label="Your blend">
      <SectionHeader
        title={playlist.name}
        explanation={`${playlist.songs.length} song${playlist.songs.length === 1 ? '' : 's'} from both of your likes · updated ${relativeTime(rec.builtAt)}`}
        seeAllTo={`/collection/${playlist.id}`}
        action={
          <button type="button" onClick={() => void blend.run('refresh')} disabled={blend.busy} className="vx-tap px-4 min-h-[36px] rounded-full btn-secondary text-[13px] font-semibold disabled:opacity-60">
            {blend.busy ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />
      {songs.length > 0 && (
        <div className="vx-group">
          {songs.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0"><SongRow song={s} songs={playlist.songs} index={i} /></div>
              <span className="text-[12px] font-semibold text-ink-400 shrink-0">{sourceLabel(rec.from[s.id], who)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
