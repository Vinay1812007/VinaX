import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from '@/components/Sheet';
import { toast } from '@/store/toastStore';
import { clearPersonalization, downloadProfileExport } from '@/features/settings/actions';
import { notifySoftMutesChanged } from '@/services/personalization/softMutes';

/**
 * 7.2 — the taste reset, with the backup offered first.
 *
 * The old path was a `window.confirm` that said "this cannot be undone" and
 * left the listener to find the export on their own. This one says exactly
 * what goes and what stays, downloads a backup in one tap, and only then
 * offers the red button.
 */
export function ResetTasteSheet({ onClose, onDone, showDataLink = true }: { onClose: () => void; onDone?: () => void; showDataLink?: boolean }) {
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState(false);

  const backup = (): void => {
    downloadProfileExport();
    setBackedUp(true);
    toast('Backup file downloaded');
  };

  const reset = async (): Promise<void> => {
    setBusy(true);
    await clearPersonalization();
    notifySoftMutesChanged();
    setBusy(false);
    toast('Taste profile reset — recommendations start fresh');
    onDone?.();
    onClose();
  };

  return (
    <Sheet onClose={onClose} labelledBy="vx-reset-taste-title" size="md">
      <h2 id="vx-reset-taste-title" className="vx-sheet-title !pt-0">Reset your taste profile?</h2>
      <div className="mt-3 grid gap-3 text-[14px] leading-relaxed">
        <div>
          <p className="font-semibold text-ink-100">What goes</p>
          <p className="mt-0.5 text-ink-300">
            What VinaX learned on this device: the languages and artists it thinks you like, your listening habits, the taste dials
            and any “Less like this” mutes.
          </p>
        </div>
        <div>
          <p className="font-semibold text-ink-100">What stays</p>
          <p className="mt-0.5 text-ink-300">
            Your favourites, playlists, listening history, “Never play” list and settings stay exactly as they are. Recommendations
            start from popular and trending songs again until you have played a few.
          </p>
        </div>
      </div>
      <p className="mt-4 text-[13px] text-ink-400 leading-relaxed">
        There is no undo — VinaX has no copy on a server. A backup file is the way back.
        {showDataLink && (
          <>
            {' '}
            <Link to="/settings#your-data" className="vx-tap font-semibold text-ink-100 underline decoration-[rgb(var(--tide-400)/0.6)] underline-offset-[3px] hover:decoration-current">
              More backup options in Settings → Your Data
            </Link>
            .
          </>
        )}
      </p>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <button type="button" onClick={onClose} className="btn-secondary min-h-touch px-5 text-sm">
          Keep my taste profile
        </button>
        <button type="button" onClick={backup} disabled={backedUp} className="btn-secondary min-h-touch px-5 text-sm disabled:opacity-60">
          {backedUp ? 'Backup downloaded' : 'Download a backup first'}
        </button>
        <button
          type="button"
          onClick={() => void reset()}
          disabled={busy}
          className="min-h-touch rounded-full px-5 text-sm font-bold text-ink-950 bg-[color:var(--vx-danger)] hover:brightness-105 disabled:opacity-60"
        >
          {busy ? 'Resetting…' : 'Reset taste profile'}
        </button>
      </div>
    </Sheet>
  );
}
