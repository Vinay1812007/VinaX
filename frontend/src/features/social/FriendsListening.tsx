import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSocialStore } from '@/features/social/store';
import { resolveSongs } from '@/features/social/resolve';
import { usePlayerStore } from '@/store/playerStore';
import { FALLBACK_ART } from '@/utils/images';
import { PlayIcon } from '@/components/Icons';

/**
 * 15.0 — "Friends are listening": the people you follow who share what
 * they have on, with the song, one tap to play it. Hidden while nobody
 * shares anything (or you follow nobody).
 */
export function FriendsListening() {
  const following = useSocialStore((s) => s.following);
  const live = (Array.isArray(following) ? following : []).filter((p) => p?.nowPlaying?.id);
  const key = live.map((p) => `${p.handle}:${p.nowPlaying?.id}`).join(',');
  const songs = useQuery({ queryKey: ['friends-now', key], queryFn: () => resolveSongs(live.map((p) => p.nowPlaying!), 12), enabled: live.length > 0, staleTime: 5 * 60_000 });
  if (!live.length) return null;
  const byId = new Map((songs.data ?? []).map((s) => [s.id, s]));
  return (
    <section className="vxh-friends" aria-label="Friends are listening">
      <div className="vxh-head"><h2>Friends are listening</h2><Link className="vx-section-link" to="/settings#profile">Profile</Link></div>
      <ul className="vxh-friends-row">
        {live.map((p) => {
          const song = byId.get(p.nowPlaying!.id);
          const art = p.nowPlaying?.image || FALLBACK_ART;
          return (
            <li key={p.handle} className="vxh-friend">
              <Link to={`/u/${p.handle}`} className="vxh-friend-who" aria-label={`${p.name ?? p.handle}'s profile`}>
                <img src={p.picture ?? FALLBACK_ART} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="vxh-friend-avatar" />
                <span className="vxh-friend-name">{p.name ?? p.handle}</span>
              </Link>
              <button type="button" className="vxh-friend-song" disabled={!song} onClick={() => song && usePlayerStore.getState().playQueue([song], 0)} aria-label={`Play ${p.nowPlaying?.title ?? 'this song'}`}>
                <img src={art} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="vxh-friend-art" />
                <span className="vxh-friend-text">
                  <span className="vxh-friend-title">{p.nowPlaying?.title ?? 'Something'}</span>
                  <span className="vxh-friend-sub">{p.nowPlaying?.subtitle ?? ''}</span>
                </span>
                <span className="vxh-friend-play" aria-hidden><PlayIcon /></span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
