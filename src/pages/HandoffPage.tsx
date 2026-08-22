import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { isNativePlatform } from '@/services/native';
import { exportProfileJson, importProfileJson } from '@/features/settings/actions';
import { generatePassphrase, looksLikePassphrase, openProfile, sealProfile } from '@/features/settings/handoff';
import { DevicesIcon } from '@/components/Icons';

const API_BASE = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';

type SendState =
  | { step: 'idle' }
  | { step: 'working' }
  | { step: 'ready'; id: string; words: string[]; url: string; qr: string; expiresAt: number }
  | { step: 'unavailable' }
  | { step: 'error' };

type ReceiveState = 'idle' | 'working' | 'wrong-words' | 'gone' | 'bad-code' | 'rate' | 'unavailable' | 'error';

/** Manual codes are 10 chars of the relay's alphabet (no i/l/o/0/1). */
const CODE_RE = /^[a-z2-9]{10}$/;

/** mm:ss until the relay burns the blob. */
function countdown(expiresAt: number, now: number): string {
  const left = Math.max(0, Math.floor((expiresAt - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/**
 * Package C1 — "Move to a new device". The profile is encrypted on-device with
 * a 6-word passphrase; the relay stores only ciphertext for 10 minutes and
 * burns it on first read. The passphrase rides the QR's URL fragment (which
 * never reaches any server) or the listener's own head.
 */
export default function HandoffPage() {
  usePageTitle('Move to a new device');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const incomingId = params.get('c');
  // Receive-first mode (?mode=receive): sign-up's "Move from old device"
  // lands here — the visitor is on the NEW device, so lead with receiving
  // instead of the sender's "Create transfer".
  const receiveFirst = params.get('mode') === 'receive';
  const [manualId, setManualId] = useState('');
  const [manualIdErr, setManualIdErr] = useState(false);

  // ---------- send ----------
  const [send, setSend] = useState<SendState>({ step: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (send.step !== 'ready') return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [send.step]);

  const createTransfer = async (): Promise<void> => {
    setSend({ step: 'working' });
    try {
      const words = generatePassphrase();
      // The relay assigns its storage id only after upload, so the KDF salt
      // can't be that id — instead a client-random PUBLIC salt travels with
      // the fragment / manual code. A salt doesn't need secrecy; per-transfer
      // uniqueness is what makes precomputed tables useless.
      const saltId = generatePassphrase().slice(0, 2).join('-');
      const sealed = await sealProfile(exportProfileJson(), words, saltId);
      const res = await fetch(`${API_BASE}/api/handoff`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sealed),
      });
      if (res.status === 503) {
        setSend({ step: 'unavailable' });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const { id, ttl } = (await res.json()) as { id: string; ttl: number };
      // Fragment carries salt + words — it never reaches a server or a log.
      const url = `${window.location.origin}/handoff?c=${id}#${saltId}.${words.join('-')}`;
      const { toDataURL } = await import('qrcode');
      const qr = await toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
      setSend({ step: 'ready', id, words, url, qr, expiresAt: Date.now() + ttl * 1000 });
    } catch {
      setSend({ step: 'error' });
    }
  };

  // ---------- receive ----------
  const [recv, setRecv] = useState<ReceiveState>('idle');
  const [manualWords, setManualWords] = useState('');
  const autoTried = useRef(false);

  const receive = async (id: string, saltId: string, words: string[]): Promise<void> => {
    if (!looksLikePassphrase(words)) {
      setRecv('wrong-words');
      return;
    }
    setRecv('working');
    try {
      const res = await fetch(`${API_BASE}/api/handoff?c=${encodeURIComponent(id)}`);
      if (res.status === 404) {
        setRecv('gone');
        return;
      }
      // Specific statuses get specific guidance — these all used to collapse
      // into a misleading "check your connection".
      if (res.status === 400) {
        setRecv('bad-code');
        return;
      }
      if (res.status === 429) {
        setRecv('rate');
        return;
      }
      if (res.status === 503) {
        setRecv('unavailable');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const sealed = (await res.json()) as { blob: string; iv: string };
      const json = await openProfile(sealed, words, saltId);
      // A wrong passphrase fails GCM auth — but the blob is already burned.
      if (json == null) {
        setRecv('wrong-words');
        return;
      }
      if (!importProfileJson(json)) setRecv('error');
      // importProfileJson reloads the app on success — nothing more to do.
    } catch {
      setRecv('error');
    }
  };

  // Scanned QR: id in ?c=, salt + words in the fragment. Auto-run once.
  useEffect(() => {
    if (!incomingId || autoTried.current) return;
    autoTried.current = true;
    const frag = window.location.hash.replace(/^#/, '');
    const dot = frag.indexOf('.');
    if (dot > 0) {
      const saltId = frag.slice(0, dot);
      const words = frag.slice(dot + 1).split('-').filter(Boolean);
      void receive(incomingId, saltId, words);
    }
  }, [incomingId]);

  const manualReceive = (): void => {
    const parts = manualWords.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
    // Manual format: "salt1-salt2 word1 word2 word3 word4 word5 word6"
    if (!incomingId || parts.length < 7) {
      setRecv('wrong-words');
      return;
    }
    void receive(incomingId, parts[0], parts.slice(1, 7));
  };

  // ---------- render ----------
  if (incomingId) {
    return (
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-extrabold tracking-tight mb-1">Import this profile?</h1>
        <p className="text-sm text-ink-400 mb-5">
          Your favorites, taste and settings from the other device will replace what&rsquo;s on this one.
        </p>
        {recv === 'working' && <p className="text-sm text-ink-300">Decrypting on this device…</p>}
        {recv === 'gone' && (
          <p className="text-sm text-red-300 mb-4">
            This transfer has expired or was already used — codes work exactly once, for 10 minutes. Create a fresh one
            on your other device.
          </p>
        )}
        {recv === 'wrong-words' && (
          <p className="text-sm text-red-300 mb-4">
            Those words didn&rsquo;t unlock it. For safety each code works only once — create a fresh transfer and try
            again, typing the words exactly.
          </p>
        )}
        {recv === 'bad-code' && (
          <p className="text-sm text-red-300 mb-4">
            That code doesn&rsquo;t look right — it&rsquo;s the 10 characters shown under the QR on your other device
            (letters and numbers only, never i, l, o, 0 or 1).
          </p>
        )}
        {recv === 'rate' && (
          <p className="text-sm text-red-300 mb-4">Too many attempts — wait a minute, then try again.</p>
        )}
        {recv === 'unavailable' && (
          <p className="text-sm text-red-300 mb-4">
            Instant transfer isn&rsquo;t enabled on this server yet. Use the file route instead: Settings → Your Data →
            Export on the old device, then Import here.
          </p>
        )}
        {recv === 'error' && <p className="text-sm text-red-300 mb-4">Something went wrong — create a fresh transfer and try again.</p>}
        {(recv === 'idle' || recv === 'wrong-words' || recv === 'bad-code' || recv === 'rate' || recv === 'error') && (
          <>
            <label className="block text-sm text-ink-300 mb-1.5" htmlFor="vx-handoff-words">
              Code + secret words (shown under the QR on your other device)
            </label>
            <input
              id="vx-handoff-words"
              value={manualWords}
              onChange={(e) => setManualWords(e.target.value)}
              placeholder="e.g. apple-brook tiger lotus pearl comet maple dawn"
              className="glass-input w-full px-4 py-2.5 rounded-xl text-sm"
              autoCapitalize="none"
              autoCorrect="off"
            />
            <button onClick={manualReceive} className="w-full mt-3 py-3 rounded-full btn-primary font-semibold">
              Unlock &amp; import
            </button>
          </>
        )}
        <p className="mt-5 text-xs text-ink-500">
          Decryption happens entirely on this device. The relay only ever saw ciphertext, and it&rsquo;s already gone.
        </p>
      </div>
    );
  }

  const receiveBox = send.step === 'idle' && (
    <div className={receiveFirst ? 'rounded-2xl border border-ember-500/40 bg-ink-850/50 p-4' : 'mt-6 rounded-2xl border border-ink-700 bg-ink-850/50 p-4'}>
      <p className="text-sm font-bold mb-1">{receiveFirst ? 'Bring everything from your old device' : 'Receiving from another device?'}</p>
      {receiveFirst && (
        <ol className="text-xs text-ink-400 mb-3 list-decimal pl-4 space-y-1">
          <li>On your <b>old</b> device, open Settings → <b>Move to a new device</b> → Create transfer.</li>
          <li>Scan the QR it shows with this device&rsquo;s camera — or type its code below.</li>
        </ol>
      )}
      {!receiveFirst && <p className="text-xs text-ink-400 mb-3">Type the code shown under its QR.</p>}
      <div className="flex gap-2">
        <input
          value={manualId}
          onChange={(e) => { setManualId(e.target.value.toLowerCase().trim()); setManualIdErr(false); }}
          placeholder="Code, e.g. k3mfp7wq2n"
          className={manualIdErr ? 'glass-input flex-1 min-w-0 px-3 py-2 rounded-xl text-sm font-mono ring-1 ring-red-400/70' : 'glass-input flex-1 min-w-0 px-3 py-2 rounded-xl text-sm font-mono'}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <button
          onClick={() => {
            if (!CODE_RE.test(manualId)) { setManualIdErr(true); return; }
            navigate(`/handoff?c=${encodeURIComponent(manualId)}`);
          }}
          disabled={!manualId}
          className="px-4 py-2 rounded-full btn-primary text-sm font-semibold disabled:opacity-50 shrink-0"
        >
          Next
        </button>
      </div>
      {manualIdErr && (
        <p className="mt-2 text-xs text-red-300">Codes are exactly 10 letters/numbers (never i, l, o, 0 or 1) — check the old device&rsquo;s screen.</p>
      )}
    </div>
  );

  return (
    <div className="max-w-md mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-10 h-10 rounded-xl bg-ember-500/15 text-ember-300 flex items-center justify-center">
          <DevicesIcon className="w-5 h-5" />
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight">Move to a new device</h1>
      </div>
      <p className="text-sm text-ink-400 mb-6">
        No account needed — ever. Your profile is encrypted here, parked for 10 minutes, and burned the moment the new
        device picks it up.
      </p>

      {receiveFirst && <div className="mb-6">{receiveBox}</div>}

      {send.step === 'idle' && (
        receiveFirst ? (
          <p className="text-xs text-ink-500 mb-2">
            Sending FROM this device instead?{' '}
            <button onClick={() => void createTransfer()} className="text-ember-400 font-semibold">Create a transfer</button>
          </p>
        ) : (
          <button onClick={() => void createTransfer()} className="w-full py-3 rounded-full btn-primary font-bold">
            Create transfer
          </button>
        )
      )}
      {send.step === 'working' && <p className="text-sm text-ink-300">Encrypting your profile on this device…</p>}
      {send.step === 'unavailable' && (
        <div className="rounded-2xl border border-ink-700 bg-ink-850/50 p-4">
          <p className="text-sm text-ink-200 mb-2">Instant transfer isn&rsquo;t enabled on this server yet.</p>
          <p className="text-xs text-ink-400">
            You can still move everything with a file: Settings → Your Data → <b>Export</b> here, then <b>Import</b> on
            the new device.
          </p>
        </div>
      )}
      {send.step === 'error' && (
        <p className="text-sm text-red-300">Couldn&rsquo;t create the transfer — check your connection and try again.</p>
      )}
      {send.step === 'ready' && (
        <div className="rounded-2xl border border-ink-700 bg-ink-850/50 p-5 text-center">
          <img src={send.qr} alt="Transfer QR code" className="mx-auto w-64 h-64 rounded-xl bg-white p-2" />
          <p className="mt-3 text-sm font-semibold text-ink-200">
            Scan with the new device&rsquo;s camera
            <span className="text-ink-400"> · expires in {countdown(send.expiresAt, now)}</span>
          </p>
          <div className="mt-4 text-left rounded-xl bg-ink-900/60 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-1.5">
              No camera? On the new device open Settings → Move to a new device and type the code below
            </p>
            <p className="text-xs text-ink-400">
              Code: <span className="font-mono text-ink-100">{send.id}</span>
            </p>
            <p className="text-xs text-ink-400 mt-1">
              Secret words:{' '}
              <span className="font-mono text-ink-100 break-all">
                {send.url.split('#')[1]?.split('.')[0]} {send.words.join(' ')}
              </span>
            </p>
          </div>
          <p className="mt-3 text-[11px] text-ink-500">
            The words above are the only key — they were never sent anywhere. One scan and the parked copy is destroyed.
          </p>
        </div>
      )}

      {!receiveFirst && receiveBox}

      <p className="mt-6 text-xs text-ink-500">
        Prefer a file? <Link to="/settings" className="text-ember-400 font-semibold">Settings → Your Data</Link> has
        Export / Import — works fully offline.
      </p>
    </div>
  );
}
