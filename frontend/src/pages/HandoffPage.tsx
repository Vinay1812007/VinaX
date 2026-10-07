import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { isNativePlatform } from '@/services/native';
import { exportTransferJson, importTransferJson } from '@/features/settings/actions';
import { generatePassphrase, looksLikePassphrase, openProfile, sealProfile } from '@/features/settings/handoff';
import { PageHeader } from '@/components/PageHeader';
import { StepList, type Step } from '@/features/settings/StepList';
import '@/styles/pages/secondary.css';

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
      const sealed = await sealProfile(exportTransferJson(), words, saltId);
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
      if (!importTransferJson(json).ok) setRecv('error');
      // importTransferJson reloads the app on success — nothing more to do.
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
    const unlocking = recv === 'working';
    const failed = recv === 'gone' || recv === 'unavailable' || recv === 'error';
    const receiveSteps: Step[] = [
      { title: 'Code from the other device', note: 'Found in this link.', state: recv === 'bad-code' ? 'error' : 'done' },
      {
        title: 'Secret words',
        note: 'The words shown under the QR. They never leave this device.',
        state: recv === 'wrong-words' ? 'error' : unlocking || failed ? 'done' : 'current',
      },
      {
        title: 'Decrypt and import',
        note: 'Replaces favorites, taste and settings here, then reloads.',
        state: unlocking ? 'current' : failed ? 'error' : 'upcoming',
      },
    ];
    return (
      <div className="vx-sec is-narrow">
        <PageHeader title="Import this profile?" subtitle="Favorites, taste and settings from the other device replace what’s on this one." />
        <div className="vx-sec-block !mb-8">
          <StepList label="Import progress" steps={receiveSteps} />
        </div>
        <div aria-live="polite">
          {recv === 'working' && <p className="text-[15px] font-semibold text-ink-200">Decrypting on this device…</p>}
          {recv === 'gone' && (
            <p className="vx-handoff-error">
              This transfer has expired or was already used — codes work exactly once, for 10 minutes. Create a fresh one
              on your other device.
            </p>
          )}
          {recv === 'wrong-words' && (
            <p className="vx-handoff-error">
              Those words didn&rsquo;t unlock it. For safety each code works only once — create a fresh transfer and try
              again, typing the words exactly.
            </p>
          )}
          {recv === 'bad-code' && (
            <p className="vx-handoff-error">
              That code doesn&rsquo;t look right — it&rsquo;s the 10 characters shown under the QR on your other device
              (letters and numbers only, never i, l, o, 0 or 1).
            </p>
          )}
          {recv === 'rate' && <p className="vx-handoff-error">Too many attempts — wait a minute, then try again.</p>}
          {recv === 'unavailable' && (
            <p className="vx-handoff-error">
              Instant transfer isn&rsquo;t enabled on this server yet. Use the file route instead: Settings → Your data →
              Export on the old device, then Import here.
            </p>
          )}
          {recv === 'error' && <p className="vx-handoff-error">Something went wrong — create a fresh transfer and try again.</p>}
        </div>
        {(recv === 'idle' || recv === 'wrong-words' || recv === 'bad-code' || recv === 'rate' || recv === 'error') && (
          <div className="vx-panel">
            <label className="vx-label" htmlFor="vx-handoff-words">
              Code + secret words (shown under the QR on your other device)
            </label>
            <input
              id="vx-handoff-words"
              value={manualWords}
              onChange={(e) => setManualWords(e.target.value)}
              placeholder="e.g. apple-brook tiger lotus pearl comet maple dawn"
              className="vx-sec-field"
              autoCapitalize="none"
              autoCorrect="off"
            />
            <button type="button" onClick={manualReceive} className="w-full mt-4 !min-h-[48px] rounded-full btn-primary">
              Unlock &amp; import
            </button>
          </div>
        )}
        <p className="vx-sec-foot mt-6">
          Decryption happens entirely on this device. The relay only ever saw ciphertext, and it&rsquo;s already gone.
        </p>
      </div>
    );
  }

  const sendFailed = send.step === 'error' || send.step === 'unavailable';
  const sendSteps: Step[] = [
    {
      title: 'Create a transfer',
      note: send.step === 'working' ? 'Encrypting your profile on this device…' : 'Your profile is encrypted here with six secret words.',
      state: send.step === 'ready' ? 'done' : sendFailed ? 'error' : 'current',
    },
    {
      title: 'Scan or type the code on the new device',
      note: send.step === 'ready' ? `Expires in ${countdown(send.expiresAt, now)}.` : 'Within 10 minutes.',
      state: send.step === 'ready' ? 'current' : 'upcoming',
    },
    { title: 'Imported on the new device', note: 'The parked copy is destroyed the moment the new device reads it.', state: 'upcoming' },
  ];

  const receiveBox = send.step === 'idle' && (
    <div className={receiveFirst ? 'vx-panel' : 'vx-panel mt-10'}>
      <h2 className="vx-sec-sub">{receiveFirst ? 'Bring everything from your old device' : 'Receiving from another device?'}</h2>
      {receiveFirst && (
        <ol className="text-[14px] text-ink-300 mt-2 mb-4 list-decimal pl-5 space-y-1.5 leading-relaxed">
          <li>On your <b className="text-ink-100">old</b> device, open Settings → <b className="text-ink-100">Move to a new device</b> → Create transfer.</li>
          <li>Scan the QR it shows with this device&rsquo;s camera — or type its code below.</li>
        </ol>
      )}
      {!receiveFirst && <p className="text-[14px] text-ink-400 mt-1 mb-4">Type the code shown under its QR.</p>}
      <div className="flex gap-2">
        <input
          value={manualId}
          onChange={(e) => { setManualId(e.target.value.toLowerCase().trim()); setManualIdErr(false); }}
          placeholder="Code, e.g. k3mfp7wq2n"
          aria-label="Transfer code"
          aria-invalid={manualIdErr || undefined}
          aria-describedby={manualIdErr ? 'vx-handoff-code-err' : undefined}
          className={manualIdErr ? 'vx-sec-field is-invalid flex-1 min-w-0 font-mono' : 'vx-sec-field flex-1 min-w-0 font-mono'}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <button
          type="button"
          onClick={() => {
            if (!CODE_RE.test(manualId)) { setManualIdErr(true); return; }
            navigate(`/handoff?c=${encodeURIComponent(manualId)}`);
          }}
          disabled={!manualId}
          className="px-6 !min-h-[48px] rounded-full btn-primary disabled:opacity-50 shrink-0"
        >
          Next
        </button>
      </div>
      {manualIdErr && (
        <p id="vx-handoff-code-err" className="mt-2 text-[13px] font-semibold text-[color:var(--vx-danger)]">Codes are exactly 10 letters/numbers (never i, l, o, 0 or 1) — check the old device&rsquo;s screen.</p>
      )}
    </div>
  );

  return (
    <div className="vx-sec is-narrow">
      <PageHeader
        title="Move to a new device"
        subtitle="Encrypted here, parked for 10 minutes, deleted the moment the new device picks it up."
      />

      {receiveFirst && <div className="mb-8">{receiveBox}</div>}

      {!(receiveFirst && send.step === 'idle') && (
        <div className="vx-sec-block !mb-8">
          <StepList label="Transfer progress" steps={sendSteps} />
        </div>
      )}

      {send.step === 'idle' && (
        receiveFirst ? (
          <p className="text-[14px] text-ink-400 mb-2">
            Sending from this device instead?{' '}
            <button type="button" onClick={() => void createTransfer()} className="vx-link min-h-[44px]">Create a transfer</button>
          </p>
        ) : (
          <button type="button" onClick={() => void createTransfer()} className="w-full !min-h-[52px] rounded-full btn-primary text-base">
            Create transfer
          </button>
        )
      )}
      <div aria-live="polite">
        {send.step === 'working' && <p className="text-[15px] font-semibold text-ink-200">Encrypting your profile on this device…</p>}
        {send.step === 'unavailable' && (
          <div className="vx-panel">
            <p className="text-[15px] font-semibold text-ink-100 mb-1">Instant transfer isn&rsquo;t enabled on this server yet.</p>
            <p className="text-[14px] text-ink-400">
              You can still move everything with a file: Settings → Your data → <b className="text-ink-100">Export</b> here, then <b className="text-ink-100">Import</b> on
              the new device.
            </p>
          </div>
        )}
        {send.step === 'error' && (
          <p className="vx-handoff-error">Couldn&rsquo;t create the transfer — check your connection and try again.</p>
        )}
      </div>
      {send.step === 'ready' && (
        <div className="vx-panel text-center">
          <img src={send.qr} alt="Transfer QR code" className="vx-qr" />
          <p className="mt-5 text-[16px] font-bold text-ink-100">Scan with the new device&rsquo;s camera</p>
          <p className="mt-1 text-[14px] font-semibold text-ink-400 tabular-nums">Expires in {countdown(send.expiresAt, now)}</p>
          <div className="mt-6 text-left rounded-[var(--vx-radius-card)] bg-ink-100/[0.05] p-4">
            <p className="text-[13.5px] font-semibold text-ink-200 mb-3">
              No camera? On the new device open Settings → Move to a new device and type the code below
            </p>
            <p className="text-[13.5px] text-ink-400">
              Code: <span className="vx-code-inline font-mono">{send.id}</span>
            </p>
            <p className="text-[13.5px] text-ink-400 mt-1.5">
              Secret words:{' '}
              <span className="vx-code-inline font-mono break-all">
                {send.url.split('#')[1]?.split('.')[0]} {send.words.join(' ')}
              </span>
            </p>
          </div>
          <p className="vx-sec-foot mx-auto">
            The words above are the only key — they were never sent anywhere. One scan and the parked copy is destroyed.
          </p>
        </div>
      )}

      {!receiveFirst && receiveBox}

      <p className="vx-sec-foot mt-10">
        Prefer a file? <Link to="/settings#your-data" className="vx-link">Settings → Your data</Link> has
        Export / Import — works fully offline.
      </p>
    </div>
  );
}
