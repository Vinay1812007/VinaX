/**
 * 11.7.2 — "the app never asks for notification permission".
 *
 * Before 11.7.2 the only web ask was a card at the very bottom of Home that
 * showed ONCE — "Not now" hid it for good — and the Android app had no ask
 * at all after its first launch: Settings → Notifications offered an alerts
 * toggle that never touched the OS permission.
 *
 * One place now answers "can we ask, and how":
 *   - `notifyState()`  'askable' | 'on' | 'blocked' | 'unsupported'
 *   - `turnOnNotifications()`  web push or Android push, whichever this is
 *   - `installNotifyAsk()`  after the listener's second song in a session, a
 *     snackbar offers "Turn on". The TAP is the user gesture browsers require
 *     before they show a permission dialog; a prompt fired on page load is
 *     silently suppressed by Chrome's quiet UI and refused by Safari/Firefox.
 * "Not now" (or ignoring it) snoozes the ask for a week; it never nags inside
 * a session and never asks once the answer is yes or a hard no.
 */
import { isNativePlatform } from '@/services/native';
import { enablePush, isPushSubscribed, pushSupported } from '@/services/push';
import { enableNativePush, nativePushPermission } from './nativePush';
import { onPlaybackEvent } from '@/services/playback/session';
import { toast } from '@/store/toastStore';

export type NotifyState = 'askable' | 'on' | 'blocked' | 'unsupported';
export type TurnOnResult = 'ok' | 'denied' | 'unsupported' | 'error';

export const ASK_SNOOZE_KEY = 'vinax.notify-ask.snooze.v1';
export const ASK_SNOOZE_MS = 7 * 86_400_000;
/** Songs a session plays before the ask appears. */
export const ASK_AFTER_PLAYS = 2;

export async function notifyState(): Promise<NotifyState> {
  if (isNativePlatform()) {
    const p = await nativePushPermission();
    return p === 'granted' ? 'on' : p === 'prompt' ? 'askable' : p === 'denied' ? 'blocked' : 'unsupported';
  }
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  // Granted but never confirmed by the server: turning on re-registers without a dialog.
  if (Notification.permission === 'granted') return (await isPushSubscribed()) ? 'on' : 'askable';
  return 'askable';
}

export function turnOnNotifications(): Promise<TurnOnResult> {
  return isNativePlatform() ? enableNativePush() : enablePush();
}

/** What to tell the listener after a turn-on attempt. */
export function turnOnMessage(r: TurnOnResult): string {
  if (r === 'ok') return 'Notifications on — you’ll know when something new lands';
  if (r === 'denied') {
    return isNativePlatform()
      ? 'Notifications are blocked — turn them on in Android Settings → Apps → VinaX → Notifications'
      : 'Notifications are blocked — allow them from the lock icon next to the address';
  }
  if (r === 'unsupported') return 'This browser can’t show notifications';
  return 'Couldn’t turn on notifications — try again from Settings';
}

export function snoozeAsk(now = Date.now()): void {
  try {
    localStorage.setItem(ASK_SNOOZE_KEY, String(now + ASK_SNOOZE_MS));
  } catch {
    /* storage is optional */
  }
}

export function askSnoozed(now = Date.now()): boolean {
  try {
    const until = Number(localStorage.getItem(ASK_SNOOZE_KEY));
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

/** Offer "Turn on" once a session, after the listener's second song. Returns the unsubscribe. */
export function installNotifyAsk(): () => void {
  let plays = 0;
  let asked = false;
  const off = onPlaybackEvent((e) => {
    if (e.kind !== 'counted' || asked) return;
    plays += 1;
    if (plays < ASK_AFTER_PLAYS || askSnoozed()) return;
    asked = true;
    void notifyState()
      .then((state) => {
        if (state !== 'askable') return;
        // Shown means answered for this week, whether they tap or not.
        snoozeAsk();
        toast('Get one new song a day, picked for you?', {
          key: 'notify-ask',
          duration: 12_000,
          action: {
            label: 'Turn on',
            onClick: () => {
              void turnOnNotifications().then((r) => toast(turnOnMessage(r), { key: 'notify-ask' }));
            },
          },
        });
      })
      .catch(() => undefined);
  });
  return off;
}
