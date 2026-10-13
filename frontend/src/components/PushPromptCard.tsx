import { useEffect, useState } from 'react';
import { toast } from '@/store/toastStore';
import { BellIcon } from './Icons';

/**
 * Notifications ask on Home — web push AND the Android app.
 *
 * 11.7.2 — it used to show once ever ("Not now" hid it for good), never on
 * the app (the WebView has no Push API, but the app has native push), and not
 * when a browser had granted permission without the server ever saving the
 * device. Now it shows whenever notifications can still be turned on, and
 * "Not now" hides it for 14 days. The shared logic is services/push/notifyAsk.
 */
export const CARD_KEY = 'vinax.push-prompt.v2';
export const CARD_SNOOZE_MS = 14 * 86_400_000;

function cardSnoozed(now = Date.now()): boolean {
  try {
    const until = Number(localStorage.getItem(CARD_KEY));
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

export function PushPromptCard() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (cardSnoozed()) return undefined;
    let live = true;
    void import('@/services/push/notifyAsk')
      .then((m) => m.notifyState())
      .then((state) => {
        if (live && state === 'askable') setShow(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!show) return null;
  const dismiss = (): void => {
    try {
      localStorage.setItem(CARD_KEY, String(Date.now() + CARD_SNOOZE_MS));
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  const turnOn = async (): Promise<void> => {
    setBusy(true);
    try {
      const m = await import('@/services/push/notifyAsk');
      const r = await m.turnOnNotifications();
      toast(m.turnOnMessage(r));
      if (r === 'ok' || r === 'denied' || r === 'unsupported') setShow(false);
    } catch {
      toast('Couldn’t turn on notifications — try again from Settings');
    } finally {
      setBusy(false);
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
