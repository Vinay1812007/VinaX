import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativePlatform } from '@/services/native';
import { alertsSnoozedUntil, snoozeAlerts } from '@/services/announcements';
import { toast } from '@/store/toastStore';
import { MegaphoneIcon, MusicIcon } from '@/components/Icons';
import { Sheet, SheetHeader } from './Sheet';

interface Announcement {
  title?: string;
  body?: string;
  link?: string;
  ts?: number;
  /** Optional cover for the row (a song pick, a release); a glyph otherwise. */
  image?: string;
}
interface NoteRow {
  version: string;
  title: string;
}

function ago(ts?: number): string {
  if (!ts) return '';
  const h = Math.round((Date.now() - ts) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** "Today", "Yesterday", then the date ("Monday, 29 Sept"); undated → "Earlier". */
export function dayLabel(ts: number | undefined, now = Date.now()): string {
  if (!ts) return 'Earlier';
  const startOf = (t: number): number => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((startOf(now) - startOf(ts)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

/** Newest first, grouped under one heading per day. */
export function groupByDay<T extends { ts?: number }>(items: T[], now = Date.now()): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of [...items].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))) {
    const label = dayLabel(item.ts, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/**
 * Canvas 3c — notification center: today's pick + recent release notes.
 * 10.1.0 — the inbox: a frosted sheet, artwork-led rows, grouped by day.
 */
export function NotificationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [snoozed, setSnoozed] = useState(() => alertsSnoozedUntil() != null);
  useEffect(() => {
    if (!open) return;
    const base = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';
    void fetch(`${base}/api/announcements?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { announcements?: Announcement[] } | null) => setAnns(d?.announcements ?? []))
      .catch(() => setAnns([]));
    void import('@/constants/changelog').then((m) => {
      const rows = Object.entries(m.CHANGELOG_V2)
        .slice(0, 3)
        .map(([version, info]) => ({ version, title: (info as { title?: string }).title ?? 'Improvements' }));
      setNotes(rows);
    });
  }, [open]);
  const groups = groupByDay(anns);
  return (
    <Sheet open={open} onClose={onClose} labelledBy="notification-sheet-title" backdropClassName="bg-black/60">
        <SheetHeader id="notification-sheet-title" title="Notifications" onClose={onClose} />
        <div className="vx-inbox">
          {groups.length === 0 && <p className="vx-inbox-empty">Nothing new right now.</p>}
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h3 className="vx-inbox-day">{g.label}</h3>
              <ul>
                {g.items.map((ann, i) => (
                  <li key={ann.ts ?? i}>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        if (typeof ann.link === 'string' && ann.link.startsWith('/')) navigate(ann.link);
                      }}
                      className="vx-inbox-row"
                    >
                      <span className="vx-inbox-art" aria-hidden>
                        {ann.image ? (
                          <img src={ann.image} alt="" loading="lazy" decoding="async" />
                        ) : ann.link?.startsWith('/song/') ? (
                          <MusicIcon className="w-5 h-5" />
                        ) : (
                          <MegaphoneIcon className="w-5 h-5" />
                        )}
                      </span>
                      <span className="vx-inbox-text">
                        <span className="vx-inbox-title">{ann.title}</span>
                        {ann.body && <span className="vx-inbox-body">{ann.body}</span>}
                      </span>
                      {ann.ts ? <span className="vx-inbox-time">{ago(ann.ts)}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {notes.length > 0 && (
            <section aria-label="From VinaX">
              <h3 className="vx-inbox-day">From VinaX</h3>
              <ul>
                {notes.map((n) => (
                  <li key={n.version} className="vx-inbox-row is-static">
                    <span className="vx-inbox-art is-app" aria-hidden>
                      <img src="/icons/icon.svg" alt="" width={44} height={44} />
                    </span>
                    <span className="vx-inbox-text">
                      <span className="vx-inbox-title">VinaX {n.version} is here</span>
                      <span className="vx-inbox-body">{n.title}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {/* D7 — a week of quiet, without touching the permanent toggle. */}
        {isNativePlatform() && (
          <button
            onClick={() => {
              if (snoozed) return;
              snoozeAlerts(7);
              setSnoozed(true);
              toast('Alerts muted for 7 days');
            }}
            className="w-full mt-4 min-h-[44px] rounded-full btn-secondary text-[14px] disabled:opacity-60"
            disabled={snoozed}
          >
            {snoozed ? 'Alerts muted for 7 days' : 'Mute alerts for 7 days'}
          </button>
        )}
    </Sheet>
  );
}
