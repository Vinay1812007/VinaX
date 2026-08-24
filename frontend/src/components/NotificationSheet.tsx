import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativePlatform } from '@/services/native';
import { alertsSnoozedUntil, snoozeAlerts } from '@/services/announcements';
import { toast } from '@/store/toastStore';
import { XIcon } from '@/components/Icons';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { useFocusTrap } from '@/hooks/useFocusTrap';

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
  useDismissOnBack(open, onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open, onClose);
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-ink-950/70 backdrop-blur-sm p-0 sm:p-6" onClick={onClose}>
      <div
        ref={dialogRef}
        className="w-full sm:max-w-md glass-modal rounded-t-3xl sm:rounded-3xl p-5 animate-fade-up"
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-extrabold">Notifications</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full text-ink-400 hover:text-ink-100 hover:bg-[var(--tile-hover)]">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2">
          {anns.length > 0 ? (
            anns.map((ann, i) => (
              <button
                key={ann.ts ?? i}
                onClick={() => {
                  onClose();
                  if (typeof ann.link === 'string' && ann.link.startsWith('/')) navigate(ann.link);
                }}
                className="w-full text-left rounded-[18px] bg-[var(--tile)] border border-[var(--glass-border)] p-3 flex items-start gap-3 hover:bg-[var(--tile-hover)] transition"
              >
                <span className="w-9 h-9 rounded-[14px] flex items-center justify-center text-base shrink-0" style={{ background: 'rgba(34,211,238,0.14)' }} aria-hidden>
                  🎵
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold truncate">{ann.title}</span>
                  <span className="block text-[11px] font-semibold text-ink-400 truncate">
                    {ann.body} {ann.ts ? `— ${ago(ann.ts)}` : ''}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="rounded-[18px] bg-[var(--tile)] border border-[var(--glass-border)] p-3 text-xs text-ink-400">
              Nothing new right now — today&rsquo;s pick lands here.
            </p>
          )}
          {notes.map((n) => (
            <div key={n.version} className="rounded-[18px] bg-[var(--tile)] border border-[var(--glass-border)] p-3 flex items-start gap-3">
              <span className="w-9 h-9 rounded-[14px] flex items-center justify-center text-base shrink-0" style={{ background: 'rgba(167,139,250,0.14)' }} aria-hidden>
                ✨
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold truncate">VinaX {n.version} is here</span>
                <span className="block text-[11px] font-semibold text-ink-400 truncate">{n.title}</span>
              </span>
            </div>
          ))}
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
            className="w-full mt-3 py-2 rounded-full border border-ink-600 text-xs font-semibold text-ink-300 hover:text-ink-100 transition disabled:opacity-60"
            disabled={snoozed}
          >
            {snoozed ? 'Alerts muted for 7 days ✓' : 'Mute alerts for 7 days'}
          </button>
        )}
      </div>
    </div>
  );
}
