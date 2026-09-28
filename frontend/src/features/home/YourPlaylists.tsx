import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { orderCollections, useLibraryStore, type LocalCollection, type SavedEntity } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';
import { letterAvatar } from '@/utils/avatar';
import type { ImageVariant, Song } from '@/types';

export interface PlaylistCard {
  key: string;
  to: string;
  title: string;
  subtitle: string;
  image: string;
  images?: ImageVariant[];
  songs: Song[] | null;
}

/**
 * 8.2.0 — "Your playlists" on Home: the listener's own playlists (pinned
 * first, then newest) followed by the playlists they saved, newest first.
 * An empty playlist of their own still shows (they made it); nothing at all
 * means no shelf.
 */
export function yourPlaylists(collections: LocalCollection[], saved: SavedEntity[], limit = 16): PlaylistCard[] {
  const own = orderCollections([...collections].sort((a, b) => b.createdAt - a.createdAt)).map<PlaylistCard>((c) => {
    const art = c.songs.find((s) => s.images?.length);
    return {
      key: `c:${c.id}`,
      to: `/collection/${c.id}`,
      title: c.name,
      subtitle: c.songs.length === 1 ? '1 song' : `${c.songs.length} songs`,
      image: art ? bestImage(art.images) : letterAvatar(c.name),
      images: art?.images,
      songs: c.songs.length ? c.songs : null,
    };
  });
  const theirs = saved
    .filter((e) => e.kind === 'playlist')
    .sort((a, b) => b.savedAt - a.savedAt)
    .map<PlaylistCard>((e) => ({
      key: `p:${e.id}`,
      to: `/playlist/${e.id}`,
      title: e.title,
      subtitle: e.subtitle || 'Playlist',
      image: e.image ?? letterAvatar(e.title),
      songs: null,
    }));
  return [...own, ...theirs].slice(0, limit);
}

export function YourPlaylistsShelf() {
  const collections = useLibraryStore((s) => s.collections);
  const saved = useLibraryStore((s) => s.saved);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const cards = yourPlaylists(collections, saved);
  if (!cards.length) return null;
  return (
    <Shelf title="Your playlists" seeAllTo="/library">
      {cards.map((c) => (
        <MediaCard
          key={c.key}
          to={c.to}
          image={c.image}
          images={c.images}
          title={c.title}
          subtitle={c.subtitle}
          onPlay={c.songs ? () => playQueue(c.songs!, 0) : undefined}
        />
      ))}
    </Shelf>
  );
}
