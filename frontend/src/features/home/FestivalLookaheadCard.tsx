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
    <div className="glass-card rounded-2xl p-4 relative overflow-hidden min-w-0">
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: ribbonGradient(info.ribbon) }} />
      <div className="flex items-center gap-3.5">
        <span className="text-[30px] leading-none shrink-0" aria-hidden>{info.festival.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-extrabold tracking-[0.18em] uppercase" style={{ color: info.accent }}>Coming up</span>
          <span className="block text-[15px] font-extrabold leading-tight truncate">{info.title}</span>
          <span className="block text-[11px] font-semibold text-ink-300 mt-0.5 truncate">{info.note}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        <button
          type="button"
          onClick={() => void play()}
          disabled={busy}
          aria-busy={busy}
          className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-60 active:scale-95 transition-transform"
        >
          <PlayIcon className="w-3 h-3" /> {busy ? 'Finding songs…' : `Play ${info.shortName} songs`}
        </button>
        <Link to="/settings" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold">
          <SettingsIcon className="w-3.5 h-3.5" /> Theme settings
        </Link>
      </div>
    </div>
  );
}
