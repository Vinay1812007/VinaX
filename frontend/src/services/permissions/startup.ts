/**
 * The start-up permission ask (web and the Android app).
 *
 * When VinaX opens and a permission it uses has never been answered, the
 * "Allow access" sheet (components/PermissionsSheet) lists it with the reason
 * and an Allow button. The listener's tap is what makes the ask work:
 * browsers drop a permission prompt that no tap started, and on Android the
 * system dialog now follows the explanation instead of appearing bare.
 *
 * Asked for: notifications (playback controls on the lock screen, the daily
 * pick) and the microphone (voice search, VinaX AI voice). A permission the
 * listener refused is not asked again here; the sheet says where to turn it
 * on. "Not now" hides the sheet for three days.
 */
import { isNativePlatform } from '@/services/native';
import { notifyState, turnOnNotifications, snoozeAsk, type NotifyState, type TurnOnResult } from '@/services/push/notifyAsk';
import { nativeMicPermission, nativeMicState } from '@/features/voice/stt';

export type PermKind = 'notifications' | 'microphone';
export type PermState = NotifyState;
export type PermStates = Record<PermKind, PermState>;
export type AllowResult = TurnOnResult;

export const PERM_SNOOZE_KEY = 'vinax.perm-ask.snooze.v1';
export const PERM_SNOOZE_MS = 3 * 86_400_000;
/** The answer to our own mic ask, for browsers that cannot report it. */
export const MIC_ANSWER_KEY = 'vinax.perm-ask.mic.v1';
function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage is optional */
  }
}

export async function micState(): Promise<PermState> {
  if (isNativePlatform()) {
    const p = await nativeMicState();
    return p === 'granted' ? 'on' : p === 'denied' ? 'blocked' : p === 'prompt' ? 'askable' : 'unsupported';
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const s = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return s.state === 'granted' ? 'on' : s.state === 'denied' ? 'blocked' : 'askable';
  } catch {
    // The browser cannot say: go by the answer it gave our own ask.
    const a = readKey(MIC_ANSWER_KEY);
    return a === 'granted' ? 'on' : a === 'denied' ? 'blocked' : a === 'none' ? 'unsupported' : 'askable';
  }
}

export async function allowMic(): Promise<AllowResult> {
  if (isNativePlatform()) return (await nativeMicPermission()) ? 'ok' : 'denied';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Only the permission was wanted: the mic closes at once.
    for (const t of stream.getTracks()) t.stop();
    writeKey(MIC_ANSWER_KEY, 'granted');
    return 'ok';
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      writeKey(MIC_ANSWER_KEY, 'denied');
      return 'denied';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      writeKey(MIC_ANSWER_KEY, 'none');
      return 'unsupported';
    }
    return 'error';
  }
}

export const allowNotifications = (): Promise<AllowResult> => turnOnNotifications();

export async function permissionStates(): Promise<PermStates> {
  const [notifications, microphone] = await Promise.all([
    notifyState().catch((): PermState => 'unsupported'),
    micState().catch((): PermState => 'unsupported'),
  ]);
  return { notifications, microphone };
}

export function permAskSnoozed(now = Date.now()): boolean {
  const until = Number(readKey(PERM_SNOOZE_KEY));
  return Number.isFinite(until) && until > now;
}

export function snoozePermAsk(now = Date.now()): void {
  writeKey(PERM_SNOOZE_KEY, String(now + PERM_SNOOZE_MS));
}

/** The sheet was shown: the after-second-song notification snackbar stays quiet this week. */
export function markPermAskShown(): void {
  snoozeAsk();
}

export const anyAskable = (s: PermStates): boolean => s.notifications === 'askable' || s.microphone === 'askable';

/** Automated browsers (end-to-end tests) never get an unasked-for sheet over the page. */
const automated = (): boolean => typeof navigator !== 'undefined' && !!navigator.webdriver;

/** Open at start-up? Not while snoozed, and only with something to ask. */
export function startupAskDue(s: PermStates, now = Date.now()): boolean {
  return !automated() && !permAskSnoozed(now) && anyAskable(s);
}

/** Open at the end of the welcome? Whenever something is unanswered. */
export const welcomeAskDue = (s: PermStates): boolean => !automated() && anyAskable(s);
