import { useState } from 'react';
import { useUpdateStore } from '@/store/updateStore';
import { downloadAndInstall, type InstallPhase } from '@/services/update';

/**
 * Mandatory in-app update dialog: blocks the UI when a newer version exists,
 * downloads the APK inside the app, and opens the Android installer directly.
 */
export function UpdateDialog() {
  const info = useUpdateStore((s) => s.info);
  const [phase, setPhase] = useState<InstallPhase | 'idle' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!info) return null;

  const start = () => {
    setError(null);
    void downloadAndInstall(info.apkUrl, setPhase, info.sha256).catch((err: unknown) => {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Download failed');
    });
  };

  const busy = phase === 'downloading' || phase === 'installing';

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-ink-950/85 backdrop-blur-sm p-0 sm:p-6">
      <div className="w-full sm:max-w-sm glass-modal rounded-t-3xl sm:rounded-3xl p-6 animate-fade-up">
        <div className="flex items-center gap-3 mb-3">
          <img src="/icons/icon.svg" alt="" className="w-11 h-11 rounded-xl" />
          <div>
            <h2 className="text-lg font-bold">Update required</h2>
            <p className="text-xs text-ink-300">v{info.current} → v{info.latest}</p>
          </div>
        </div>
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
        <p className="text-[11px] text-ink-500 mt-3 text-center">
          First time only: Android will ask to allow updates from VinaX.
        </p>
      </div>
    </div>
  );
}
