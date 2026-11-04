/**
 * "Allow access" — the start-up permission sheet (web and the Android app).
 * Opens when VinaX starts with a permission still unanswered, right after the
 * welcome on a first run, and from Settings → Region & privacy. Each row says
 * why VinaX wants it; the Allow tap is what lets the browser or Android show
 * its own dialog. The logic lives in services/permissions/startup.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { KEYS } from '@/constants/storage-keys';
import { getLocal } from '@/services/storage/local';
import { isNativePlatform } from '@/services/native';
import {
  allowMic,
  allowNotifications,
  anyAskable,
  markPermAskShown,
  permissionStates,
  snoozePermAsk,
  startupAskDue,
  welcomeAskDue,
  type AllowResult,
  type PermKind,
  type PermState,
  type PermStates,
} from '@/services/permissions/startup';
import { OPEN_PERMISSIONS_EVENT, type PermissionsOpenSource } from '@/services/permissions/open';
import { toast } from '@/store/toastStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { cn } from '@/utils/cn';
import { Sheet, SheetHeader } from './Sheet';
import { useAccount } from './useAccount';
import { BellIcon, CheckIcon, MicIcon } from './Icons';

/** Another dialog (What's New, the welcome, an announcement) or a guided tour is up: wait for it. */
const otherDialogOpen = (): boolean =>
  !!document.querySelector('[role="dialog"][aria-modal="true"]') || useTutorialStore.getState().activeId !== null;
const WAIT_MS = 1_500;

interface RowDef {
  kind: PermKind;
  icon: ReactNode;
  title: string;
  why: string;
  fix: string;
}

function rows(native: boolean): RowDef[] {
  return [
    {
      kind: 'notifications',
      icon: <BellIcon className="w-5 h-5" />,
      title: 'Notifications',
      why: native
        ? 'Play, pause and skip from your lock screen, and one new song a day picked for you.'
        : 'One new song a day picked for you, and a heads-up when new music lands.',
      fix: native
        ? 'Blocked. Turn it on in Android Settings → Apps → VinaX → Notifications.'
        : 'Blocked. Allow it from the lock icon next to the address.',
    },
    {
      kind: 'microphone',
      icon: <MicIcon className="w-5 h-5" />,
      title: 'Microphone',
      why: 'Search by voice and talk to VinaX AI. Only used while you are speaking.',
      fix: native
        ? 'Blocked. Turn it on in Android Settings → Apps → VinaX → Permissions.'
        : 'Blocked. Allow it from the lock icon next to the address.',
    },
  ];
}

export function PermissionsSheet() {
  const account = useAccount();
  const { pathname } = useLocation();
  const [states, setStates] = useState<PermStates | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<PermKind | 'all' | null>(null);
  const startupChecked = useRef(false);
  const waitTimer = useRef(0);
  const native = isNativePlatform();

  const show = (s: PermStates): void => {
    setStates(s);
    setOpen(true);
    markPermAskShown();
  };
  /** Open once nothing else is on screen. */
  const showWhenClear = (s: PermStates): void => {
    window.clearTimeout(waitTimer.current);
    const tryOpen = (): void => {
      if (otherDialogOpen()) waitTimer.current = window.setTimeout(tryOpen, WAIT_MS);
      else show(s);
    };
    waitTimer.current = window.setTimeout(tryOpen, WAIT_MS);
  };
  useEffect(() => () => window.clearTimeout(waitTimer.current), []);

  // Start-up: once signed in and past the welcome, open if something is unanswered.
  const ready = !!account && getLocal<boolean>(KEYS.onboarded, false) && pathname !== '/handoff';
  useEffect(() => {
    if (!ready || startupChecked.current) return;
    startupChecked.current = true;
    void permissionStates().then((s) => {
      if (startupAskDue(s)) showWhenClear(s);
    });
    // Runs once; show/showWhenClear only set state and timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // The welcome's end opens it when something is unanswered; Settings opens it to review.
  useEffect(() => {
    const onOpen = (e: Event): void => {
      const source = (e as CustomEvent<PermissionsOpenSource>).detail;
      startupChecked.current = true;
      void permissionStates().then((s) => {
        if (source === 'welcome') {
          if (welcomeAskDue(s)) showWhenClear(s);
        } else if (s.notifications !== 'unsupported' || s.microphone !== 'unsupported') show(s);
        else toast('Nothing to allow here: this device has no notifications or microphone VinaX can use.');
      });
    };
    window.addEventListener(OPEN_PERMISSIONS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PERMISSIONS_EVENT, onOpen);
    // Listens once; show/showWhenClear only set state and timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open || !states) return null;

  const visible = rows(native).filter((r) => states[r.kind] !== 'unsupported');
  const askable = anyAskable(states);

  const close = (): void => {
    if (anyAskable(states)) snoozePermAsk();
    setOpen(false);
  };

  const ask = async (kind: PermKind): Promise<AllowResult> =>
    kind === 'notifications' ? allowNotifications() : allowMic();

  const allowOne = async (kind: PermKind): Promise<void> => {
    setBusy(kind);
    const r = await ask(kind).catch((): AllowResult => 'error');
    const next = await permissionStates();
    setBusy(null);
    setStates(next);
    if (r === 'error') toast(`Couldn’t turn on ${kind === 'notifications' ? 'notifications' : 'the microphone'}. Try again from Settings.`);
  };

  const allowAll = async (): Promise<void> => {
    setBusy('all');
    // Notifications first: browsers want that dialog straight after the tap.
    for (const kind of ['notifications', 'microphone'] as const) {
      if (states[kind] === 'askable') await ask(kind).catch(() => undefined);
    }
    const next = await permissionStates();
    setBusy(null);
    setStates(next);
    if (!anyAskable(next) && next.notifications !== 'blocked' && next.microphone !== 'blocked') {
      setOpen(false);
      toast('All set. You can change these any time in your settings.');
    }
  };

  return (
    <Sheet onClose={close} labelledBy="vx-perm-title" size="sm" closeOnBackdrop={false}>
      <SheetHeader
        id="vx-perm-title"
        title="Allow access"
        subtitle={`VinaX works best with these. Change them any time in your ${native ? 'phone' : 'browser'} settings.`}
        onClose={close}
        closeLabel="Not now"
      />
      <ul className="mt-4 grid gap-2.5" aria-label="Permissions">
        {visible.map((r) => {
          const st: PermState = states[r.kind];
          return (
            <li key={r.kind} className="flex items-start gap-3 rounded-2xl p-3 bg-[rgb(var(--ink-100)/0.06)]">
              <span aria-hidden className="mt-0.5 shrink-0 grid place-items-center w-9 h-9 rounded-full bg-[rgb(var(--ink-100)/0.1)] text-ink-100">
                {r.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-ink-100">{r.title}</p>
                <p className={cn('mt-0.5 text-[13px] leading-snug', st === 'blocked' ? 'text-[color:var(--vx-danger)]' : 'text-ink-300')}>
                  {st === 'blocked' ? r.fix : r.why}
                </p>
              </div>
              {st === 'on' ? (
                <span className="shrink-0 self-center inline-flex items-center gap-1 text-[13px] font-bold text-ink-200">
                  <CheckIcon className="w-4 h-4" /> Allowed
                </span>
              ) : st === 'askable' ? (
                <button
                  type="button"
                  onClick={() => void allowOne(r.kind)}
                  disabled={busy !== null}
                  aria-label={`Allow ${r.title.toLowerCase()}`}
                  className="shrink-0 self-center h-9 px-4 rounded-full btn-secondary text-[13.5px] font-bold disabled:opacity-60"
                >
                  {busy === r.kind ? '…' : 'Allow'}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex gap-2.5">
        {askable ? (
          <>
            <button type="button" onClick={close} className="flex-1 h-12 rounded-full btn-secondary text-[15px]">Not now</button>
            <button
              type="button"
              onClick={() => void allowAll()}
              disabled={busy !== null}
              className="flex-1 h-12 rounded-full btn-primary text-[15px] font-bold disabled:opacity-60"
            >
              {busy === 'all' ? 'Asking…' : 'Allow all'}
            </button>
          </>
        ) : (
          <button type="button" onClick={close} className="flex-1 h-12 rounded-full btn-primary text-[15px] font-bold">Done</button>
        )}
      </div>
    </Sheet>
  );
}

export default PermissionsSheet;
