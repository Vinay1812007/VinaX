import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettingsStore } from '@/store/settingsStore';
import { usePlayerStore } from '@/store/playerStore';
import { searchSongs } from '@/services/api';
import { toast } from '@/store/toastStore';
import { PlayIcon, SettingsIcon } from '@/components/Icons';
import { localDateKey } from '@/features/home/useBecauseYouLiked';
import { festivalLookahead, ribbonGradient } from '@/features/home/festivalLookahead';

/**
 * v5.19.0 — "Coming up" card in Home's personal band: the next festival when
 * it is one to three days away (and none is on today), wearing that
 * festival's theme ribbon. One chip queues festival songs from the catalog,
 * the other opens Settings. Same compact language as StreakCard.
 */
export function FestivalLookaheadCard() {
  const skinsOn = useSettingsStore((s) => s.festivalSkins);
  // Day-stable: the lookahead only changes at midnight or when the setting flips.
  const dateKey = localDateKey();
  const info = useMemo(() => festivalLookahead(new Date(`${dateKey}T12:00:00`), skinsOn), [dateKey, skinsOn]);
  const [busy, setBusy] = useState(false);
  if (!info) return null;

  const play = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const songs = await searchSongs(info.query, 30);
      if (!songs.length) {
        toast(`No ${info.shortName} songs found yet — try Search`);
        return;
      }
      usePlayerStore.getState().playQueue(songs, 0);
    } catch {
      toast('Could not load songs — check your connection');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vxh-card">
      <span aria-hidden className="vxh-card-ribbon" style={{ background: ribbonGradient(info.ribbon) }} />
      <span
        className="vxh-card-art"
        style={{ background: ribbonGradient(info.ribbon) }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="vxh-card-label">Coming up</span>
        <span className="vxh-card-title">{info.title}</span>
        <span className="vxh-card-sub">{info.note}</span>
        <span className="vxh-card-links">
          <button
            type="button"
            onClick={() => void play()}
            disabled={busy}
            aria-busy={busy}
            className="vxh-mini is-primary"
          >
            <PlayIcon /> {busy ? 'Finding songs…' : `Play ${info.shortName} songs`}
          </button>
          <Link to="/settings" className="vxh-mini">
            <SettingsIcon /> Theme settings
          </Link>
        </span>
      </span>
    </div>
  );
}
