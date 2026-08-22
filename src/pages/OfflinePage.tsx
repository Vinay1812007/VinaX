import { Link } from 'react-router-dom';
import { songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { useDownloadsStore } from '@/store/downloadsStore';
import { removeDownload } from '@/services/downloads';
import { usePlayerStore } from '@/store/playerStore';
import { isNativePlatform } from '@/services/native';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { PlayIcon } from '@/components/Icons';
import { toast } from '@/store/toastStore';

export default function OfflinePage() {
  usePageTitle('Downloads');
  const items = useDownloadsStore((s) => s.items);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const list = Object.values(items).sort((a, b) => b.addedAt - a.addedAt);
  const songs = list.map((x) => x.song);

  if (!list.length) {
    return (
      <div className="max-w-2xl mx-auto">
        <PageHeader title="Downloads" />
        <div className="glass-panel rounded-2xl p-8 text-center text-ink-300 leading-relaxed">
          {isNativePlatform() ? (
            <p>No downloads yet. Open the ⋯ menu on any song and choose <b>Download</b> to save it for offline listening.</p>
          ) : (
            <p>Offline downloads are available in the VinaX Android app.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-10">
      <PageHeader title="Downloads" />
      <p className="text-sm text-ink-400 -mt-2 mb-5">{list.length} song{list.length > 1 ? 's' : ''} saved for offline.</p>
      <div className="space-y-2">
        {list.map(({ song }, i) => (
          <div key={song.id} className="flex items-center gap-3 glass-card rounded-xl p-2.5">
            <button onClick={() => playQueue(songs, i)} className="relative shrink-0 group" aria-label={`Play ${song.title}`}>
              <img
                src={bestImage(song.images, 150)}
                onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-11 h-11 rounded-lg object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                <PlayIcon className="w-5 h-5 text-white" />
              </span>
            </button>
            <Link to={songPath(song)} className="min-w-0 flex-1">
              <span className="block text-sm font-semibold truncate">{song.title}</span>
              <span className="block text-xs text-ink-400 truncate">{song.subtitle}</span>
            </Link>
            <button
              onClick={() => void removeDownload(song.id).then(() => toast('Removed download'))}
              className="text-xs font-semibold text-ink-400 hover:text-red-300 shrink-0 px-2 py-1"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
