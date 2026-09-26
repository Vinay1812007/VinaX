import { useEffect, useState } from 'react';
import { enablePush, pushSupported } from '@/services/push';
import { toast } from '@/store/toastStore';
import { BellIcon } from './Icons';

const KEY = 'vinax.push-prompt.v1';

/** One-time notifications ask on Home (web push). Hidden on the app — the
 *  WebView has no Push API; the app uses announcement alerts instead. */
export function PushPromptCard() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      if (!pushSupported()) return;
      if (localStorage.getItem(KEY)) return;
      if (Notification.permission !== 'default') return;
      setShow(true);
    } catch {
      /* stay hidden */
    }
  }, []);
  if (!show) return null;
  const dismiss = (): void => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  const turnOn = async (): Promise<void> => {
    setBusy(true);
    const r = await enablePush();
    setBusy(false);
    if (r === 'ok') {
      toast('Notifications on — you’ll know when something new lands');
      dismiss();
    } else if (r === 'denied') {
      dismiss();
    } else {
      toast('Could not enable notifications — try from Settings later');
      setShow(false);
    }
  };
  return (
    <div className="vxh-note">
      <span className="vxh-note-icon" aria-hidden>
        <BellIcon />
      </span>
      <span className="vxh-note-text">
        <span className="vxh-note-title">One song a day, tuned to you</span>
        <span className="vxh-note-sub">Today’s pick and the odd announcement. Never spam.</span>
      </span>
      <span className="vxh-note-actions">
        <button type="button" onClick={dismiss} className="vxh-note-btn is-quiet">
          Not now
        </button>
        <button type="button" onClick={() => void turnOn()} disabled={busy} className="vxh-note-btn">
          {busy ? 'Turning on…' : 'Turn on'}
        </button>
      </span>
    </div>
  );
}
