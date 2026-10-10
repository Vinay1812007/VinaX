import { useState, useRef } from 'react';
import { useUpdateStore } from '@/store/updateStore';
import { downloadAndInstall, installLikelyBlocked, snoozeUpdate, type InstallPhase } from '@/services/update';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';

/**
 * In-app update dialog: shown when a newer version exists, downloads the APK
 * inside the app, and opens the Android installer directly.
 *
 * v5.8.2 — Update now / Update later. The gate is no longer mandatory: later
 * closes it for this build for a day (the Home banner keeps the reminder),
 * a newer build brings it straight back, and Settings → Check for updates
 * always shows it. Escape and Android back count as "later" too.
 *
 * v4.13.3 — reinstall guidance: Android permanently refuses to install an APK
 * over an app signed with a different key ("package conflicts with an
 * existing package"). Devices still on old debug-signed builds hit exactly
 * that. There is no installer callback, so the signal is the dialog
 * reappearing for the SAME build after an attempt — then we stop looping the
 * user through a doomed installer and walk them through the one-time path:
 * export data → uninstall → install → import.
 */
export function UpdateDialog() {
  const info = useUpdateStore((s) => s.info);
  const [phase, setPhase] = useState<InstallPhase | 'idle' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const later = () => {
    if (!info || info.mandatory) return;
    snoozeUpdate(info.latestBuild);
    useUpdateStore.getState().setInfo(null);
  };
  // Hooks stay above the early return (rules-of-hooks).
  useFocusTrap(dialogRef, info !== null, later);
  useDismissOnBack(info !== null, later);

  if (!info) return null;

  const blocked = installLikelyBlocked(info.latestBuild);

  const start = () => {
    setError(null);
    void downloadAndInstall(info.apkUrl, setPhase, info.sha256, info.latestBuild).catch((err: unknown) => {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Download failed');
    });
  };

  const exportData = () => {
    void import('@/features/settings/actions').then((m) => {
      m.downloadProfileExport();
      setExported(true);
    }).catch(() => undefined);
  };

  const busy = phase === 'downloading' || phase === 'installing';

  const spinner = <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />;
  const primary = 'w-full min-h-[48px] rounded-full btn-primary flex items-center justify-center gap-2';
  const secondary = 'w-full min-h-[48px] rounded-full btn-secondary text-[14px] font-bold';
  const quiet = 'w-full min-h-[44px] rounded-full text-[13px] font-bold text-ink-300 hover:text-ink-100 transition-colors';

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Update available"
        className="w-full sm:max-w-sm bg-ink-950 dark:bg-ink-850 border border-[color:var(--vx-border)] rounded-t-2xl sm:rounded-2xl px-6 pt-6 pb-[max(1.5rem,var(--safe-bottom))] sm:pb-6 max-h-[92dvh] overflow-y-auto overscroll-contain shadow-[0_24px_64px_-16px_rgba(0,0,0,0.65)] animate-fade-up"
      >
        <div className="flex items-center gap-3.5 mb-4">
          <img src="/icons/icon.svg" alt="" className="w-12 h-12 rounded-xl" />
          <div className="min-w-0">
            <h2 className="text-[18px] font-[750] tracking-[-0.015em]">{blocked ? 'One-time reinstall needed' : 'Update available'}</h2>
            <p className="text-[13px] text-ink-400 tabular-nums">v{info.current} → v{info.latest}</p>
          </div>
        </div>

        {blocked ? (
          <>
            <p className="text-[14px] text-ink-200 leading-relaxed mb-4">
              Your phone is blocking this update because the installed copy came from an older signing
              setup (&ldquo;package conflicts&rdquo;). One fresh install fixes it for good, and your music comes with you:
            </p>
            <ol className="text-[14px] text-ink-200 space-y-2 mb-5 list-decimal pl-5 marker:text-ink-400 marker:font-bold">
              <li className="pl-1">
                <b>Save your data</b>: one file with your favorites, history and taste.
              </li>
              <li className="pl-1"><b>Uninstall VinaX</b>, then run the installer below.</li>
              <li className="pl-1">
                Open the new app → Settings → Your data → <b>Restore a backup (quick)</b> and choose that file.
              </li>
            </ol>
            <div className="space-y-2">
              <button onClick={exportData} className={secondary}>
                {exported ? 'Data file saved — now uninstall and install' : '1 · Save my data file'}
              </button>
              <button onClick={start} disabled={busy} className={primary}>
                {busy && spinner}
                {phase === 'downloading' ? 'Downloading…' : phase === 'installing' ? 'Opening installer…' : '2 · Download installer'}
              </button>
              <button onClick={later} disabled={busy} className={quiet}>
                Update later
              </button>
            </div>
            <p className="text-[12px] text-ink-400 mt-1 text-center">
              After this once, every update installs over the top.
            </p>
          </>
        ) : (
          <>
            <p className="text-[14px] text-ink-200 leading-relaxed mb-5">
              It downloads inside the app and installs over the top. Your music, favorites and settings stay.
            </p>
            {error && <p className="text-[13px] text-[color:var(--vx-danger)] mb-3">{error} — check your connection and retry.</p>}
            <div className="space-y-2">
              <button onClick={start} disabled={busy} className={primary}>
                {busy && spinner}
                {phase === 'downloading'
                  ? 'Downloading…'
                  : phase === 'installing'
                    ? 'Opening installer…'
                    : phase === 'error'
                      ? 'Retry update'
                      : 'Update now'}
              </button>
              {info.mandatory ? (
                <p className="pt-1 text-center text-[12px] font-semibold text-ink-300">This version is no longer supported. Update to keep listening.</p>
              ) : (
                <button onClick={later} disabled={busy} className={secondary}>
                  Update later
                </button>
              )}
              {/* The data-export path stays inside the dialog: it is the first
                  thing to do before any install, so it must be one tap away. */}
              <button onClick={exportData} className={quiet}>
                {exported ? 'Data file saved to your phone' : 'Save my data file first'}
              </button>
            </div>
            <p className="text-[12px] text-ink-400 mt-1 text-center">
              First time only: your phone asks to allow updates from VinaX.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
