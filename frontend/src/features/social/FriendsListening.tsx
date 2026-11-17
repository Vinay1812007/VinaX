import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSocialStore } from '@/features/social/store';
import { resolveSongs } from '@/features/social/resolve';
import { JoinRoomLink } from '@/features/social/JoinRoomLink';
import { usePlayerStore } from '@/store/playerStore';
import { FALLBACK_ART } from '@/utils/images';
import { PlayIcon } from '@/components/Icons';

/**
 * 15.0 — "Friends are listening": the people you follow who share what
 * they have on, with the song, one tap to play it. Hidden while nobody
 * shares anything (or you follow nobody).
 *
 * v23 — a friend hosting a jam they let you join (the server sends the
 * code only to people who follow each other, while the room is live) gets
 * a Join link to the Listen Together page. A plain link: nothing of the
 * Together engine loads here.
 */
export function FriendsListening() {
  const following = useSocialStore((s) => s.following);
  const live = (Array.isArray(following) ? following : []).filter((p) => p?.nowPlaying?.id || p?.jamCode);
  const playing = live.filter((p) => p.nowPlaying?.id);
  const key = playing.map((p) => `${p.handle}:${p.nowPlaying?.id}`).join(',');
  const songs = useQuery({ queryKey: ['friends-now', key], queryFn: () => resolveSongs(playing.map((p) => p.nowPlaying!), 12), enabled: playing.length > 0, staleTime: 5 * 60_000 });
  if (!live.length) return null;
  const byId = new Map((songs.data ?? []).map((s) => [s.id, s]));
  return (
    <section className="vxh-friends" aria-label="Friends are listening">
      <div className="vxh-head"><h2>Friends are listening</h2><Link className="vx-section-link" to="/settings#profile">Profile</Link></div>
      <ul className="vxh-friends-row">
        {live.map((p) => {
          const song = p.nowPlaying ? byId.get(p.nowPlaying.id) : undefined;
          const art = p.nowPlaying?.image || FALLBACK_ART;
          const who = p.name ?? p.handle;
          return (
            <li key={p.handle} className="vxh-friend">
              <div className="vxh-friend-top">
                <Link to={`/u/${p.handle}`} className="vxh-friend-who" aria-label={`${who}'s profile`}>
                  <img src={p.picture ?? FALLBACK_ART} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="vxh-friend-avatar" />
                  <span className="vxh-friend-name">{who}</span>
                </Link>
                <JoinRoomLink profile={p} className="vxh-friend-join" />
              </div>
              {!p.nowPlaying ? (
                <p className="vxh-friend-sub">Hosting Listen Together</p>
              ) : (
              <button type="button" className="vxh-friend-song" disabled={!song} onClick={() => song && usePlayerStore.getState().playQueue([song], 0)} aria-label={`Play ${p.nowPlaying?.title ?? 'this song'}`}>
                <img src={art} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="vxh-friend-art" />
                <span className="vxh-friend-text">
                  <span className="vxh-friend-title">{p.nowPlaying?.title ?? 'Something'}</span>
                  <span className="vxh-friend-sub">{p.nowPlaying?.subtitle ?? ''}</span>
                </span>
                <span className="vxh-friend-play" aria-hidden><PlayIcon /></span>
              </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
