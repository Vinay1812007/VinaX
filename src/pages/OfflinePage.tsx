import { useState } from 'react';
import { Link } from 'react-router-dom';
import { songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { useDownloadsStore } from '@/store/downloadsStore';
import { removeDownload } from '@/services/downloads';
import { usePlayerStore } from '@/store/playerStore';
import { isNativePlatform } from '@/services/native';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { PlayIcon, DownloadIcon } from '@/components/Icons';
import { EmptyState } from '@/components/States';
import { toast } from '@/store/toastStore';

// Package D8 — estimated on-disk size. The catalog doesn't expose real file
// sizes, so we estimate from duration at the high-quality bitrate (320 kbps ≈
// 40 KB/s) and say "≈" honestly in the UI.
const BYTES_PER_SEC = 40 * 1024;

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export default function OfflinePage() {
  usePageTitle('Downloads');
  const items = useDownloadsStore((s) => s.items);
  const downloading = useDownloadsStore((s) => s.downloading);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const list = Object.values(items).sort((a, b) => b.addedAt - a.addedAt);
  const songs = list.map((x) => x.song);
  const inFlight = Object.keys(downloading).length;

  // D8 — batch selection mode.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string): void =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const deletePicked = async (): Promise<void> => {
    const ids = [...picked];
    for (const id of ids) await removeDownload(id);
    setPicked(new Set());
    setSelecting(false);
    toast(`Removed ${ids.length} download${ids.length === 1 ? '' : 's'}`);
  };

  if (!list.length && !inFlight) {
    return (
      <div className="max-w-2xl mx-auto">
        <PageHeader title="Downloads" />
        <EmptyState
          icon={<DownloadIcon className="w-8 h-8" />}
          title="No downloads yet"
          message={
            isNativePlatform()
              ? 'Open the ⋯ menu on any song and choose Download to save it for offline listening.'
              : 'Offline downloads are available in the VinaX Android app.'
          }
          action={
            isNativePlatform() ? (
              <Link to="/" className="px-5 py-2.5 rounded-full btn-primary">Browse Home</Link>
            ) : (
              <Link to="/download" className="px-5 py-2.5 rounded-full btn-primary">Get the app</Link>
            )
          }
        />
      </div>
    );
  }

  const totalSec = list.reduce((s, x) => s + (x.song.duration || 0), 0);
  const estBytes = totalSec * BYTES_PER_SEC;

  return (
    <div className="max-w-2xl mx-auto pb-10">
      <PageHeader
        title="Downloads"
        actions={
          list.length > 0 ? (
            selecting ? (
              <>
                <button
                  onClick={() => void deletePicked()}
                  disabled={picked.size === 0}
                  className="px-4 min-h-touch rounded-full text-sm font-semibold bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-40 transition"
                >
                  Delete {picked.size || ''}
                </button>
                <button
                  onClick={() => { setSelecting(false); setPicked(new Set()); }}
                  className="px-4 min-h-touch rounded-full border border-ink-600 text-sm text-ink-200"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setSelecting(true)} className="px-4 min-h-touch rounded-full border border-ink-600 text-sm text-ink-200 hover:bg-ink-800/40">
                Select
              </button>
            )
          ) : undefined
        }
      />

      {/* D8 — storage summary bar (estimate; the catalog hides real sizes). */}
      {list.length > 0 && (
        <div className="glass-card rounded-xl p-3.5 mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-semibold">{list.length} song{list.length > 1 ? 's' : ''} offline</span>
            <span className="text-ink-400 text-xs">≈ {fmtBytes(estBytes)} on device</span>
          </div>
          <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden" aria-hidden>
            <div
              className="h-full rounded-full bg-gradient-to-r from-ember-600 to-ember-400"
              style={{ width: `${Math.min(100, (estBytes / (2 * 1024 * 1024 * 1024)) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-ink-500">Estimated at high quality · change quality in Settings → Playback</p>
        </div>
      )}

      {/* D8 — in-flight downloads strip (indeterminate; no byte progress from the pipe). */}
      {inFlight > 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border border-tide-500/30 bg-tide-500/10 px-3.5 py-2.5 mb-4">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-tide-400 border-t-transparent animate-spin shrink-0" aria-hidden />
          <p className="text-xs font-semibold text-tide-300">
            Downloading {inFlight} song{inFlight > 1 ? 's' : ''}… they appear below as they finish.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {list.map(({ song }, i) => (
          <div key={song.id} className="flex items-center gap-3 glass-card rounded-xl p-2.5">
            {selecting && (
              <input
                type="checkbox"
                checked={picked.has(song.id)}
                onChange={() => togglePick(song.id)}
                aria-label={`Select ${song.title}`}
                className="w-[18px] h-[18px] accent-ember-500 shrink-0 cursor-pointer"
              />
            )}
            <button onClick={() => (selecting ? togglePick(song.id) : playQueue(songs, i))} className="relative shrink-0 group" aria-label={`Play ${song.title}`}>
              <img
                src={bestImage(song.images, 150)}
                onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-11 h-11 rounded-lg object-cover"
              />
              {!selecting && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                  <PlayIcon className="w-5 h-5 text-white" />
                </span>
              )}
            </button>
            {selecting ? (
              <button onClick={() => togglePick(song.id)} className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-semibold truncate">{song.title}</span>
                <span className="block text-xs text-ink-400 truncate">{song.subtitle}</span>
              </button>
            ) : (
              <Link to={songPath(song)} className="min-w-0 flex-1">
                <span className="block text-sm font-semibold truncate">{song.title}</span>
                <span className="block text-xs text-ink-400 truncate">{song.subtitle}</span>
              </Link>
            )}
            {!selecting && (
              <button
                onClick={() => void removeDownload(song.id).then(() => toast('Removed download'))}
                className="text-xs font-semibold text-ink-400 hover:text-red-300 shrink-0 px-2 py-1"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
