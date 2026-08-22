import { useState, useRef } from 'react';
import { useUpdateStore } from '@/store/updateStore';
import { downloadAndInstall, installLikelyBlocked, type InstallPhase } from '@/services/update';
import { useFocusTrap } from '@/hooks/useFocusTrap';

/**
 * Mandatory in-app update dialog: blocks the UI when a newer version exists,
 * downloads the APK inside the app, and opens the Android installer directly.
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
  // Mandatory update gate: trap focus while shown, but no Escape-close and
  // no dismiss. Hooks stay above the early return (rules-of-hooks).
  useFocusTrap(dialogRef, info !== null);

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
    });
  };

  const busy = phase === 'downloading' || phase === 'installing';

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-ink-950/85 backdrop-blur-sm p-0 sm:p-6">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Update required" className="w-full sm:max-w-sm glass-modal rounded-t-3xl sm:rounded-3xl p-6 animate-fade-up">
        <div className="flex items-center gap-3 mb-3">
          <img src="/icons/icon.svg" alt="" className="w-11 h-11 rounded-xl" />
          <div>
            <h2 className="text-lg font-bold">{blocked ? 'One-time reinstall needed' : 'Update required'}</h2>
            <p className="text-xs text-ink-300">v{info.current} → v{info.latest}</p>
          </div>
        </div>

        {blocked ? (
          <>
            <p className="text-sm text-ink-200 leading-relaxed mb-4">
              Android is blocking this update because your installed copy came from an older signing
              setup (&ldquo;package conflicts&rdquo;). One fresh install fixes it forever — and your
              music survives the trip:
            </p>
            <ol className="text-[13px] text-ink-200 space-y-2 mb-4 list-decimal pl-5">
              <li className="pl-1">
                <b>Save your data</b> — one file with your favorites, history and taste.
              </li>
              <li className="pl-1"><b>Uninstall VinaX</b>, then run the installer below.</li>
              <li className="pl-1">
                Open the new app → Settings → Your Data → <b>Import</b> that file.
              </li>
            </ol>
            <button
              onClick={exportData}
              className="w-full py-3 mb-2 rounded-full btn-secondary text-sm font-bold"
            >
              {exported ? '✓ Data file saved — now uninstall & install' : '1 · Save my data file'}
            </button>
            <button
              onClick={start}
              disabled={busy}
              className="w-full py-3.5 rounded-full btn-primary flex items-center justify-center gap-2"
            >
              {busy && <span className="w-4 h-4 border-2 border-ink-950 border-t-transparent rounded-full animate-spin" />}
              {phase === 'downloading' ? 'Downloading…' : phase === 'installing' ? 'Opening installer…' : '2 · Download installer'}
            </button>
            <p className="text-[11px] text-ink-500 mt-3 text-center">
              After this one time, every future update installs over the top normally.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-200 leading-relaxed mb-5">
              A new version of VinaX is ready. It downloads inside the app and installs over the top —
              your music, favorites, and settings are kept.
            </p>
            {error && <p className="text-xs text-red-300 mb-3">{error} — check your connection and retry.</p>}
            <button
              onClick={start}
              disabled={busy}
              className="w-full py-3.5 rounded-full btn-primary flex items-center justify-center gap-2"
            >
              {busy && <span className="w-4 h-4 border-2 border-ink-950 border-t-transparent rounded-full animate-spin" />}
              {phase === 'downloading'
                ? 'Downloading…'
                : phase === 'installing'
                  ? 'Opening installer…'
                  : phase === 'error'
                    ? 'Retry update'
                    : `Update to v${info.latest}`}
            </button>
            {/* Always reachable — this dialog blocks the whole app, so the
                data-export path must live INSIDE it, not behind it. */}
            <button
              onClick={exportData}
              className="w-full py-2.5 mt-2 rounded-full text-xs font-bold text-ink-300 hover:text-ink-100 transition"
            >
              {exported ? '✓ Data file saved to your phone' : 'Save my data file first (favorites · history · taste)'}
            </button>
            <p className="text-[11px] text-ink-500 mt-1.5 text-center">
              First time only: Android will ask to allow updates from VinaX.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
