import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativePlatform } from '@/services/native';
import { alertsSnoozedUntil, snoozeAlerts } from '@/services/announcements';
import { toast } from '@/store/toastStore';
import { MegaphoneIcon, SparkleIcon } from '@/components/Icons';
import { Sheet, SheetHeader } from './Sheet';

interface Announcement {
  title?: string;
  body?: string;
  link?: string;
  ts?: number;
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

/** Canvas 3c — notification center: today's pick + recent release notes. */
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
  return (
    <Sheet open={open} onClose={onClose} labelledBy="notification-sheet-title" backdropClassName="bg-black/60">
        <SheetHeader id="notification-sheet-title" title="Notifications" onClose={onClose} />
        <ul className="-mx-2">
          {anns.length > 0 ? (
            anns.map((ann, i) => (
              <li key={ann.ts ?? i}>
                <button
                  onClick={() => {
                    onClose();
                    if (typeof ann.link === 'string' && ann.link.startsWith('/')) navigate(ann.link);
                  }}
                  className="w-full min-h-[60px] text-left rounded-lg px-2 py-2 flex items-center gap-3 hover:bg-[var(--vx-hover)] transition-colors"
                >
                  <span className="w-10 h-10 rounded-full bg-ink-100/[0.07] text-ink-200 flex items-center justify-center shrink-0" aria-hidden>
                    <MegaphoneIcon className="w-5 h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-ink-100 truncate">{ann.title}</span>
                    <span className="block text-[13px] text-ink-400 truncate">
                      {ann.body} {ann.ts ? `· ${ago(ann.ts)}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-2 py-3 text-[14px] text-ink-400">Nothing new right now.</li>
          )}
          {notes.map((n) => (
            <li key={n.version} className="min-h-[60px] px-2 py-2 flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-ink-100/[0.07] text-ink-200 flex items-center justify-center shrink-0" aria-hidden>
                <SparkleIcon className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-ink-100 truncate">VinaX {n.version} is here</span>
                <span className="block text-[13px] text-ink-400 truncate">{n.title}</span>
              </span>
            </li>
          ))}
        </ul>
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
