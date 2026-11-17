import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { EntityAction, EntityHeader, EntityMeta, GlyphCover, PlayFab, totalDuration } from '@/components/EntityHeader';
import { useDownloadsStore } from '@/store/downloadsStore';
import { canSaveOffline, removeDownload } from '@/services/downloads';
import { storageInfo, WARN_BYTES, type StorageInfo } from '@/services/downloads/web';
import { usePlayerStore } from '@/store/playerStore';
import { isNativePlatform } from '@/services/native';
import { iosWeb, standaloneWeb } from '@/utils/platform';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { PlayIcon, DownloadIcon, ShuffleIcon, XIcon } from '@/components/Icons';
import { EmptyState } from '@/components/States';
import { toast } from '@/store/toastStore';
import { VirtualChunks } from '@/components/VirtualChunks';
import { shuffled } from '@/features/library/sort';
import { cn } from '@/utils/cn';
import type { Song } from '@/types';
import '@/styles/pages/tracklist.css';

const InstallGuideSheet = lazy(() => import('@/components/InstallGuideSheet').then((m) => ({ default: m.InstallGuideSheet })));

// Package D8 — estimated on-disk size. The catalog doesn't expose real file
// sizes, so we estimate from duration at the high-quality bitrate (320 kbps ≈
// 40 KB/s) and say "≈" honestly in the UI.
const BYTES_PER_SEC = 40 * 1024;
/** The bar's scale: 2 GB fills it. An estimate against a round number, not a quota. */
const BAR_SCALE = 2 * 1024 * 1024 * 1024;

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  return `${Math.round(n / 1024)} KB`;
}

/** Row height (44px art + padding) — the off-screen size estimate for list chunks. */
const ROW_HEIGHT = 64;
const songKey = (song: Song): string => song.id;

interface RowProps {
  song: Song;
  index: number;
  selecting: boolean;
  picked: boolean;
  onTogglePick: (id: string) => void;
  onPlay: (index: number) => void;
}

/** Memoised: ticking a checkbox re-renders that row, not the whole downloads list. */
const DownloadRow = memo(function DownloadRow({ song, index, selecting, picked, onTogglePick, onPlay }: RowProps) {
  return (
    <div className={cn('vx-drow group', selecting && picked && 'is-picked')}>
      {selecting && (
        <span className="vx-crow-check">
          <input
            type="checkbox"
            checked={picked}
            onChange={() => onTogglePick(song.id)}
            aria-label={`Select ${song.title}`}
            className="w-5 h-5 accent-[rgb(var(--ember-500))] cursor-pointer"
          />
        </span>
      )}
      <button type="button" onClick={() => (selecting ? onTogglePick(song.id) : onPlay(index))} className="vx-track-art vx-drow-art" aria-label={`Play ${song.title}`}>
        <img
          src={bestImage(song.images, 150)}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          loading="lazy"
          decoding="async"
          width={44}
          height={44}
        />
        {!selecting && (
          <span className="vx-drow-over" aria-hidden>
            <PlayIcon className="w-4 h-4" />
          </span>
        )}
      </button>
      {selecting ? (
        <button type="button" onClick={() => onTogglePick(song.id)} className="vx-drow-text">
          <span className="vx-track-title"><span>{song.title}</span></span>
          <span className="vx-track-sub">{song.subtitle}</span>
        </button>
      ) : (
        <Link to={songPath(song)} className="vx-drow-text">
          <span className="vx-track-title"><span>{song.title}</span></span>
          <span className="vx-track-sub">{song.subtitle}</span>
        </Link>
      )}
      {!selecting && (
        <button
          type="button"
          onClick={() => void removeDownload(song.id).then(() => toast('Removed download'))}
          aria-label={`Remove the download of ${song.title}`}
          title="Remove download"
          className="vx-row-x is-danger vx-drow-remove"
        >
          <XIcon className="w-4 h-4" />
        </button>
      )}
    </div>
  );
});

/**
 * Downloads (offline copies: the Android app's, and since 1.16 the web app's
 * in the browser's cache). 9.0 "Encore": the header
 * plays or shuffles everything saved, a storage estimate sits under it, a
 * live strip counts what is still downloading, and Select turns the list
 * into a batch remover.
 */
export default function OfflinePage() {
  usePageTitle('Downloads');
  const items = useDownloadsStore((s) => s.items);
  const downloading = useDownloadsStore((s) => s.downloading);
  const list = useMemo(() => Object.values(items).sort((a, b) => b.addedAt - a.addedAt), [items]);
  const songs = useMemo(() => list.map((x) => x.song), [list]);
  const inFlight = Object.keys(downloading).length;
  const native = isNativePlatform();
  const savable = canSaveOffline();
  // 1.16 — web saves: what the browser really stores for this site, and the
  // iPhone nudge (Safari can clear a site's storage after a week unopened;
  // Home Screen apps keep it).
  const [space, setSpace] = useState<StorageInfo | null>(null);
  useEffect(() => {
    if (native || !savable) return;
    let live = true;
    void storageInfo().then((s) => live && setSpace(s));
    return () => {
      live = false;
    };
  }, [native, savable, list.length]);
  const showHomeTip = !native && iosWeb() && !standaloneWeb();
  const [howOpen, setHowOpen] = useState(false);

  // D8 — batch selection mode.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = useCallback(
    (id: string): void =>
      setPicked((p) => {
        const next = new Set(p);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const playFrom = useCallback((i: number): void => usePlayerStore.getState().playQueue(songs, i), [songs]);
  const shufflePlay = (): void => {
    if (!songs.length) return;
    const p = usePlayerStore.getState();
    if (!p.shuffle) p.toggleShuffle();
    p.playQueue(shuffled(songs), 0);
  };
  const renderRow = useCallback(
    (song: Song, i: number) => (
      <DownloadRow song={song} index={i} selecting={selecting} picked={picked.has(song.id)} onTogglePick={togglePick} onPlay={playFrom} />
    ),
    [selecting, picked, togglePick, playFrom],
  );
  const stopSelecting = (): void => {
    setSelecting(false);
    setPicked(new Set());
  };
  const deletePicked = async (): Promise<void> => {
    const ids = [...picked];
    for (const id of ids) await removeDownload(id);
    stopSelecting();
    toast(`Removed ${ids.length} download${ids.length === 1 ? '' : 's'}`);
  };
  const removeAll = async (): Promise<void> => {
    const ids = list.map((x) => x.song.id);
    if (!ids.length || !window.confirm(`Remove all ${ids.length} download${ids.length === 1 ? '' : 's'} from this device?`)) return;
    for (const id of ids) await removeDownload(id);
    toast('Removed all downloads');
  };

  const header = (actions?: React.ReactNode, meta?: React.ReactNode) => (
    <EntityHeader
      kind="On this device"
      title="Downloads"
      tone="var(--ink-500)"
      art={<GlyphCover tone="downloads" icon={<DownloadIcon />} />}
      meta={meta}
      actions={actions}
    />
  );

  if (!list.length && !inFlight) {
    return (
      <div className="vx-entity">
        {header(undefined, savable ? <EntityMeta items={['Songs you save play without a connection']} /> : undefined)}
        <EmptyState
          icon={<DownloadIcon className="w-8 h-8" />}
          title="No downloads yet"
          message={
            savable
              ? 'Open the ⋯ menu on any song and choose Download to save it for offline listening.'
              : 'This browser can’t save songs. Offline downloads are in the VinaX Android app.'
          }
          action={
            savable ? (
              <Link to="/" className="px-5 py-2.5 rounded-full btn-primary">Browse Home</Link>
            ) : (
              <Link to="/download" className="px-5 py-2.5 rounded-full btn-primary">Get the app</Link>
            )
          }
        />
      </div>
    );
  }

  // Web saves know their real size; Android ones are estimated from duration.
  const exact = list.every((x) => !!x.bytes);
  const estBytes = list.reduce((s, x) => s + (x.bytes || (x.song.duration || 0) * BYTES_PER_SEC), 0);
  const sizeLabel = `${exact ? '' : '≈ '}${fmtBytes(estBytes)}`;

  return (
    <div className="vx-entity">
      {header(
        list.length > 0 ? (
          <>
            <PlayFab size="lg" label="Play all" onClick={() => playFrom(0)} disabled={selecting} />
            <EntityAction label="Shuffle play" onClick={shufflePlay} disabled={selecting}><ShuffleIcon /></EntityAction>
            {selecting ? (
              <>
                <button type="button" onClick={() => void deletePicked()} disabled={picked.size === 0} className="vx-quiet-btn is-danger">
                  Delete {picked.size || ''}
                </button>
                <button type="button" onClick={stopSelecting} className="vx-quiet-btn">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setSelecting(true)} className="vx-quiet-btn">
                  Select
                </button>
                <button type="button" onClick={() => void removeAll()} className="vx-quiet-btn is-danger">
                  Remove all
                </button>
              </>
            )}
          </>
        ) : undefined,
        list.length > 0 ? <EntityMeta items={[`${list.length} song${list.length > 1 ? 's' : ''}`, totalDuration(songs), sizeLabel]} /> : undefined,
      )}

      {/* D8 — storage summary (an estimate on Android; real sizes on the web). */}
      {list.length > 0 && (
        <div className="vx-storage">
          <div className="vx-storage-head">
            <span className="vx-storage-title">{sizeLabel} on this device</span>
            <span className="vx-storage-note">
              {space
                ? `${fmtBytes(space.usage)} used · ${fmtBytes(Math.max(0, space.quota - space.usage))} free for VinaX`
                : exact
                  ? 'Saved in this browser · change quality in Settings → Playback'
                  : 'Estimated at high quality · change quality in Settings → Playback'}
            </span>
          </div>
          <div className="vx-storage-bar" aria-hidden>
            <i style={{ width: `${Math.max(1.5, Math.min(100, (estBytes / BAR_SCALE) * 100))}%` }} />
          </div>
        </div>
      )}

      {space && space.usage > WARN_BYTES && (
        <p className="vx-etools-note mb-3">Saved songs use over 1 GB. Remove ones you no longer play to free up space.</p>
      )}

      {showHomeTip && (
        <div className="vx-strip" role="note">
          <p className="vx-strip-text">
            <b>Keep your saved songs.</b>
            <span> Safari can clear them if VinaX isn’t opened for a week. Add VinaX to your Home Screen to keep them.</span>
          </p>
          <button type="button" onClick={() => setHowOpen(true)} className="vx-quiet-btn">
            How
          </button>
          {howOpen && (
            <Suspense fallback={null}>
              <InstallGuideSheet open onClose={() => setHowOpen(false)} onDone={() => setHowOpen(false)} />
            </Suspense>
          )}
        </div>
      )}

      {/* D8 — in-flight downloads strip (indeterminate; no byte progress from the pipe). */}
      {inFlight > 0 && (
        <div className="vx-strip vx-live-strip" role="status">
          <span className="vx-live-spin" aria-hidden />
          <p className="vx-strip-text">
            <b>Downloading {inFlight} song{inFlight > 1 ? 's' : ''}…</b>
            <span> they appear below as they finish.</span>
          </p>
        </div>
      )}

      {selecting && (
        <p className="vx-etools-note mb-3" aria-live="polite">{picked.size} selected — tap songs to pick them.</p>
      )}

      <div className="vx-tracklist">
        <VirtualChunks items={songs} keyOf={songKey} renderItem={renderRow} rowHeight={ROW_HEIGHT} />
      </div>
    </div>
  );
}
