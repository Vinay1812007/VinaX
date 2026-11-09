import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Sheet, SheetHeader } from './Sheet';
import { Chip } from './Chip';
import { toast } from '@/store/toastStore';
import { sendFeedback } from '@/services/feedback';
import { isReadOnly, READ_ONLY_MESSAGE } from '@/services/siteMode';
import { DISPLAY_VERSION } from '@/constants/version';
import { thisDevice } from '@/utils/device';
import { useAccount } from './useAccount';

type Kind = 'idea' | 'bug' | 'other';

const KINDS: Array<{ id: Kind; label: string; placeholder: string }> = [
  { id: 'idea', label: 'Suggest a feature', placeholder: 'What would you love VinaX to do? One idea per message is perfect…' },
  { id: 'bug', label: 'Report a bug', placeholder: 'What happened, what you expected, and the song or page if it matters…' },
  { id: 'other', label: 'Something else', placeholder: 'Anything you want to tell the VinaX team…' },
];

const MAX = 2000;

/**
 * 1.12 — Ideas & bugs: the popup behind the VinaX mark in the top bar, on
 * every platform (the Android app, iPhone and iPad web, Windows, Mac, Linux).
 * Two taps: pick "Suggest a feature" or "Report a bug", write, send. The
 * device, app version, screen and page are read for the listener and shown
 * before they send, so a report never needs "which phone?" back. Goes to the
 * owner console's Feedback inbox (services/feedback.ts); the owner can reply
 * as a notification to a signed-in listener's devices.
 */
export default function FeedbackSheet({ onClose, initialKind = 'idea' }: { onClose: () => void; initialKind?: Kind }) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const { pathname } = useLocation();
  const account = useAccount();
  const device = thisDevice();
  const facts = [
    device.label,
    DISPLAY_VERSION,
    typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : '',
    typeof navigator !== 'undefined' ? navigator.language : '',
    pathname,
  ].filter(Boolean);

  // The text box takes focus once the sheet has mounted.
  useEffect(() => {
    const t = window.setTimeout(() => document.getElementById('vx-feedback-text')?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  const submit = async () => {
    const text = message.trim();
    if (!text) { toast(kind === 'bug' ? 'Tell us what went wrong first' : 'Write your idea first'); return; }
    if (isReadOnly()) { toast(READ_ONLY_MESSAGE); return; }
    setSending(true);
    const diag = details ? ` [${facts.join(' · ')}]` : '';
    const ok = await sendFeedback(kind, text.slice(0, MAX - diag.length) + diag);
    setSending(false);
    if (ok) { setSent(true); return; }
    toast('Could not send — check your connection and try again.');
  };

  const current = KINDS.find((k) => k.id === kind) ?? KINDS[0];
  return (
    <Sheet onClose={onClose} labelledBy="vx-feedback-title" size="md">
      <SheetHeader
        id="vx-feedback-title"
        title={<span className="vx-fb-title"><img src="/icons/icon.svg?v=14" alt="" width={28} height={28} /> Ideas &amp; bugs</span>}
        subtitle={sent ? undefined : 'Straight to the VinaX team. Every message is read.'}
        onClose={onClose}
      />
      {sent ? (
        <div className="vx-fb-done" role="status">
          <p className="vx-fb-done-title">{kind === 'bug' ? 'Thanks — we’re on it.' : 'Thanks for the idea!'}</p>
          <p className="vx-fb-done-sub">
            {account ? 'If we have a question or news about it, it reaches you as a VinaX notification.' : 'Sign in with Google if you’d like a reply as a VinaX notification.'}
          </p>
          <div className="vx-fb-actions">
            <button type="button" className="vx-fb-btn is-quiet" onClick={() => { setSent(false); setMessage(''); }}>Send another</button>
            <button type="button" className="vx-fb-btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <>
          <div className="vx-fb-kinds" role="group" aria-label="What kind of message">
            {KINDS.map((k) => (
              <Chip key={k.id} active={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</Chip>
            ))}
          </div>
          <textarea
            id="vx-feedback-text"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
            placeholder={current.placeholder}
            rows={5}
            maxLength={MAX}
            aria-label="Your message"
            className="vx-fb-text"
          />
          <div className="vx-fb-meta">
            <label className="vx-check">
              <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />
              Include where it happened
            </label>
            <ul className="vx-fb-facts" aria-label="Details sent with the message">
              {facts.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
          <div className="vx-fb-actions">
            <span className="vx-fb-count" aria-live="polite">{message.length ? `${message.length} / ${MAX}` : ''}</span>
            <button type="button" className="vx-fb-btn btn-primary" onClick={() => void submit()} disabled={sending}>
              {sending ? 'Sending…' : kind === 'bug' ? 'Send bug report' : 'Send idea'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
