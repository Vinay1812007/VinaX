import { useEffect, useState } from 'react';
import { enablePush, pushSupported } from '@/services/push';
import { toast } from '@/store/toastStore';

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
    <div className="glass-panel rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-3">
      <span aria-hidden className="text-2xl">🔔</span>
      <div className="flex-1 min-w-44">
        <p className="text-sm font-bold">One song a day, tuned to you</p>
        <p className="text-xs text-ink-400">Today’s pick + the odd announcement — never spam.</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => void turnOn()}
          disabled={busy}
          className="px-4 py-2 rounded-full btn-primary text-sm font-semibold"
        >
          {busy ? 'Turning on…' : 'Turn on'}
        </button>
        <button onClick={dismiss} className="px-3.5 py-2 rounded-full btn-secondary text-sm">
          Not now
        </button>
      </div>
    </div>
  );
}
