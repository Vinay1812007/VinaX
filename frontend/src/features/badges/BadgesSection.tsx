import { useEffect, useRef, useState } from 'react';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { getLocal } from '@/services/storage/local';
import { KEYS } from '@/constants/storage-keys';
import { SectionHeader } from '@/components/SectionHeader';
import { ShareIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';
import { GROUP_LABEL, type BadgeDef } from './catalog';
import type { BadgeProgress } from './engine';
import { checkWith } from './afterPlay';

/** "9 November 2026" from a YYYY-MM-DD day. */
export function dayText(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** One badge tile: the glyph in a tinted disc, the name, a meter until it is earned. */
export function BadgeTile({ p, selected, onClick }: { p: BadgeProgress; selected?: boolean; onClick?: () => void }) {
  const style = { '--badge-h': p.def.hue } as React.CSSProperties;
  const label = p.earnedAt ? `${p.def.name}, earned ${dayText(p.earnedAt)}` : `${p.def.name}, ${p.pct}% there: ${p.def.blurb}`;
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} aria-label={label} title={p.def.blurb} style={style} className={cn('vx-tap vx-badge', !p.earnedAt && 'is-locked')}>
      <span className="vx-badge-glyph" aria-hidden>{p.def.glyph}</span>
      <span className="vx-badge-name">{p.def.name}</span>
      {!p.earnedAt && <span className="vx-badge-meter" aria-hidden><span style={{ width: `${Math.max(3, p.pct)}%` }} /></span>}
    </button>
  );
}

/**
 * 1.12 — the Badges section of the Stats page: every badge, earned ones
 * bright and first, the rest grey with how close they are. Tapping one
 * shows what it is for, the day it was earned and a Share button that paints
 * a square card on the device.
 */
export function BadgesSection() {
  const entries = useHistoryStore((s) => s.entries);
  const favorites = useLibraryStore((s) => s.favorites.length);
  const collections = useLibraryStore((s) => s.collections.length);
  const [rows, setRows] = useState<BadgeProgress[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      setRows(checkWith({ entries, favorites, playlists: collections }).progress);
    } catch {
      setRows([]);
    }
  }, [entries, favorites, collections]);
  useEffect(() => {
    // Arriving from the "Badge earned" toast: scroll the section into view.
    if (window.location.hash === '#badges') document.getElementById('badges')?.scrollIntoView?.({ block: 'start' });
  }, []);
  useEffect(() => {
    // On a phone the grid is tall and the detail sits under it, where the bottom bar would cover it: centre it when a badge is tapped.
    if (open) detailRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [open]);
  if (!rows.length) return null;
  const earned = rows.filter((r) => r.earnedAt).length;
  const sel = rows.find((r) => r.def.id === open) ?? null;

  const share = async (def: BadgeDef, earnedAt: string | null): Promise<void> => {
    setSharing(true);
    try {
      const [{ renderBadgeCard }, { shareOrSaveImage }] = await Promise.all([import('./shareCard'), import('@/utils/shareImage')]);
      const blob = await renderBadgeCard(def, earnedAt, getLocal<string>(KEYS.userName, ''));
      await shareOrSaveImage(blob, `vinax-badge-${def.id}.png`, `My ${def.name} badge on VinaX`);
    } catch {
      toast('Could not make the card right now');
    } finally {
      setSharing(false);
    }
  };

  return (
    <section id="badges" aria-label="Badges" className="vx-sec-block">
      <SectionHeader title="Badges" explanation={`${earned} of ${rows.length} earned · worked out on this device from your plays, streak, library and goals.`} />
      <div className="vx-badges">
        {rows.map((p) => <BadgeTile key={p.def.id} p={p} selected={open === p.def.id} onClick={() => setOpen(open === p.def.id ? null : p.def.id)} />)}
      </div>
      {sel && (
        <div ref={detailRef} className="vx-badge-detail" style={{ '--badge-h': sel.def.hue } as React.CSSProperties} role="region" aria-label={`${sel.def.name} details`}>
          <span className={cn('vx-badge-glyph', !sel.earnedAt && 'is-locked')} aria-hidden>{sel.def.glyph}</span>
          <div className="vx-badge-detail-main">
            <h3>{sel.def.name}</h3>
            <p>
              {sel.def.blurb} <span className="text-ink-400">· {GROUP_LABEL[sel.def.group]}</span>
            </p>
            <p>{sel.earnedAt ? `Earned ${dayText(sel.earnedAt)}` : `${sel.value.toLocaleString('en-IN')} of ${sel.def.target.toLocaleString('en-IN')} ${sel.def.unit} so far`}</p>
          </div>
          {sel.earnedAt && (
            <button type="button" onClick={() => void share(sel.def, sel.earnedAt)} disabled={sharing} className="vx-tap px-5 min-h-[44px] rounded-full btn-primary font-semibold inline-flex items-center gap-2 disabled:opacity-60">
              <ShareIcon className="w-4 h-4" /> {sharing ? 'Painting…' : 'Share'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
