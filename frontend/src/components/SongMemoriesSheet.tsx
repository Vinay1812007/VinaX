import type { Song } from '@/types';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { Sheet } from './Sheet';
import { bestImage, FALLBACK_ART } from '@/utils/images';

/**
 * v5.17.0 — "Your history with this song": plays, completions, first and
 * last time, which playlists hold it. Computed from on-device history.
 */
function fmt(ts: number): string {
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SongMemoriesSheet({ song, onClose }: { song: Song; onClose(): void }) {
  const entries = useHistoryStore((s) => s.entries);
  const favorites = useLibraryStore((s) => s.favorites);
  const collections = useLibraryStore((s) => s.collections);

  const mine = entries.filter((e) => e.song.id === song.id);
  const plays = mine.length;
  const completes = mine.filter((e) => e.completed).length;
  const first = mine.length ? Math.min(...mine.map((e) => e.ts)) : null;
  const last = mine.length ? Math.max(...mine.map((e) => e.ts)) : null;
  const liked = favorites.some((f) => f.id === song.id);
  const inLists = collections.filter((c) => c.songs.some((s) => s.id === song.id)).map((c) => c.name);
  const byHour = new Array<number>(4).fill(0);
  for (const e of mine) {
    const h = new Date(e.ts).getHours();
    byHour[h < 6 ? 3 : h < 12 ? 0 : h < 18 ? 1 : 2] += 1;
  }
  const slots = ['mornings', 'afternoons', 'evenings', 'late nights'];
  const fav = plays ? slots[byHour.indexOf(Math.max(...byHour))] : null;

  return (
    <Sheet onClose={onClose} label="Your history with this song">
        <div className="flex items-center gap-3">
          <img src={bestImage(song.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-14 h-14 rounded-xl object-cover" />
          <div className="min-w-0">
            <p className="font-bold truncate">{song.title}</p>
            <p className="text-xs text-ink-400 truncate">{song.subtitle}</p>
          </div>
        </div>
        {plays === 0 ? (
          <p className="mt-4 text-sm text-ink-300">You haven’t played this one yet — press play and it starts a story.</p>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-ink-800 p-3"><p className="text-xl font-extrabold">{plays}</p><p className="text-[11px] text-ink-400">plays</p></div>
            <div className="rounded-2xl bg-ink-800 p-3"><p className="text-xl font-extrabold">{completes}</p><p className="text-[11px] text-ink-400">finished</p></div>
            <div className="rounded-2xl bg-ink-800 p-3"><p className="text-xl font-extrabold">{plays ? Math.round((completes / plays) * 100) : 0}%</p><p className="text-[11px] text-ink-400">to the end</p></div>
          </div>
        )}
        <ul className="mt-4 space-y-1.5 text-sm text-ink-200">
          {first != null && <li>First played <b>{fmt(first)}</b>{last != null && last !== first ? <>, last <b>{fmt(last)}</b></> : null}.</li>}
          {fav && <li>You play it mostly in the <b>{fav}</b>.</li>}
          <li>{liked ? 'In your Liked Songs.' : 'Not liked yet.'}</li>
          {inLists.length > 0 && <li>In {inLists.length === 1 ? 'the playlist' : 'playlists'}: <b>{inLists.join(', ')}</b>.</li>}
        </ul>
        <p className="mt-3 text-[11px] text-ink-500">From your on-device history — nothing is uploaded.</p>
        <button type="button" onClick={onClose} className="mt-4 w-full btn-secondary py-2 text-sm">Close</button>
    </Sheet>
  );
}
