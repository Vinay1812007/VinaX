import { lazy, Suspense, useState, type ReactNode } from 'react';
import { toast } from '@/store/toastStore';
import { joinSession } from './engine';

const QrScanSheet = lazy(() => import('./QrScanSheet'));

/** A small QR glyph for the Scan button. */
function QrIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2" />
      <path d="M14 14h2.5v2.5M20.5 14v0M14 20.5h0M17.5 20.5h3v-3" />
    </svg>
  );
}

/**
 * 1.13 — join a room: type the code, or scan the host's QR with the camera
 * without leaving VinaX. Used by the Listen Together page and by the
 * Together tab of the player, so both join the same way.
 */
export function JoinRoom({ initialCode = '', inputId = 'vx-lt-code', disabled = false }: { initialCode?: string; inputId?: string; disabled?: boolean }): ReactNode {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const join = async (value: string): Promise<void> => {
    setBusy(true);
    const r = await joinSession(value);
    setBusy(false);
    if (!r.ok) toast(r.message);
  };

  return (
    <>
      <div className="vx-lt-join-row">
        <input
          id={inputId}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void join(code);
          }}
          placeholder="ABC123"
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="Room code"
          className="vx-lt-code-input"
        />
        <button type="button" onClick={() => void join(code)} disabled={busy || disabled} className="vx-lt-join">
          {busy ? 'Joining…' : 'Join'}
        </button>
      </div>
      <button type="button" className="vx-lt-scan-btn" onClick={() => setScanning(true)} disabled={busy || disabled}>
        <QrIcon />
        Scan the host’s QR
      </button>
      {scanning && (
        <Suspense fallback={null}>
          <QrScanSheet
            onClose={() => setScanning(false)}
            onCode={(scanned) => {
              setScanning(false);
              setCode(scanned);
              void join(scanned);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
