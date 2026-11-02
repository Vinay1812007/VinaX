/**
 * Console rebuild — what the owner publishes from the console's Home Screen and
 * App Updates pages, shown in the app:
 *
 *   BroadcastBar        the top message bar (style, optional link, closable or not)
 *   AnnouncementPopup   the pop-up on app open (button, once / daily / every open, platforms)
 *   VersionNotice       "please update" when this install is older than the owner allows
 *
 * All three stay silent on any failure: a bad or missing value never blocks
 * the app (except a forced update, which is the owner's explicit choice).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useClientConfig, type BroadcastStyle } from '@/features/home/useAppConfig';
import { isNativePlatform, platformName } from '@/services/native';
import { getLocal, setLocal } from '@/services/storage/local';
import { STORAGE_PREFIX } from '@/constants/storage-keys';
import { announcementDue, versionVerdict, type PopupAnnouncement } from '@/services/appRules';
import { checkForUpdate } from '@/services/update';
import { useUpdateStore } from '@/store/updateStore';
import { Sheet, SheetHeader } from './Sheet';
import { XIcon } from './Icons';

const BROADCAST_CLOSED_KEY = `${STORAGE_PREFIX}.broadcast-closed`;
const POPUP_SEEN_KEY = `${STORAGE_PREFIX}.popup-seen`;
const VERSION_SNOOZE_KEY = `${STORAGE_PREFIX}.version-snooze`;

const TONE: Record<BroadcastStyle, { bg: string; edge: string }> = {
  info: { bg: 'rgb(59 130 246 / 0.14)', edge: 'rgb(96 165 250)' },
  success: { bg: 'rgb(34 197 94 / 0.14)', edge: 'rgb(74 222 128)' },
  warning: { bg: 'rgb(245 158 11 / 0.16)', edge: 'rgb(251 191 36)' },
  urgent: { bg: 'rgb(239 68 68 / 0.16)', edge: 'rgb(248 113 113)' },
};

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 'android' | 'ios' | 'web' for this install. */
function platform(): 'android' | 'ios' | 'web' {
  if (!isNativePlatform()) return 'web';
  const p = platformName();
  return p === 'ios' ? 'ios' : 'android';
}

/** The installed version name ("1.8.3"). */
const installedVersion = (): string => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '').split('+')[0];

export function BroadcastBar() {
  const cfg = useClientConfig();
  const navigate = useNavigate();
  const [closed, setClosed] = useState(() => getLocal<string>(BROADCAST_CLOSED_KEY, ''));
  const b = cfg?.broadcast;
  if (!b || (b.dismissible !== false && closed === b.id)) return null;
  const tone = TONE[b.style ?? 'info'] ?? TONE.info;
  const link = b.link;
  return (
    <div
      role={b.style === 'urgent' || b.style === 'warning' ? 'alert' : 'status'}
      className="mb-3 flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] text-ink-100"
      style={{ background: tone.bg, borderLeft: `3px solid ${tone.edge}` }}
    >
      <p className="min-w-0 flex-1">{b.text}</p>
      {link && (
        <button type="button" className="shrink-0 min-h-[36px] px-3 rounded-full text-[13px] font-semibold underline-offset-2 hover:underline" onClick={() => navigate(link)}>
          Open
        </button>
      )}
      {b.dismissible !== false && (
        <button
          type="button"
          aria-label="Close message"
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-ink-300 hover:text-ink-100"
          onClick={() => { setLocal(BROADCAST_CLOSED_KEY, b.id); setClosed(b.id); }}
        >
          <XIcon className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

interface AnnouncementAnswer extends PopupAnnouncement { title: string; body: string; link: string; button?: string }

let popupShownThisSession = false;

export function AnnouncementPopup() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['announcement-popup'],
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<AnnouncementAnswer | null> => {
      const base = isNativePlatform() ? 'https://www.vinaxmusic.online' : '';
      const r = await fetch(`${base}/api/announcements`);
      if (!r.ok) return null;
      const j = (await r.json()) as { announcement?: AnnouncementAnswer | null };
      return j.announcement && typeof j.announcement === 'object' ? j.announcement : null;
    },
  });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!data) return;
    const seen = getLocal<{ ts?: number; day?: string } | null>(POPUP_SEEN_KEY, null);
    if (!announcementDue(data, platform(), seen, today(), popupShownThisSession)) return;
    // Let the first screen settle so the pop-up never fights the splash.
    const t = window.setTimeout(() => {
      popupShownThisSession = true;
      setLocal(POPUP_SEEN_KEY, { ts: data.ts, day: today() });
      setOpen(true);
    }, 2500);
    return () => window.clearTimeout(t);
  }, [data]);
  if (!data || !open) return null;
  const close = () => setOpen(false);
  const go = () => { close(); if (data.link && data.link !== '/') navigate(data.link); };
  return (
    <Sheet open onClose={close} labelledBy="owner-popup-title" size="sm">
      <SheetHeader id="owner-popup-title" title={data.title} onClose={close} />
      {data.body && <p className="text-[15px] text-ink-300 whitespace-pre-line">{data.body}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="min-h-[44px] px-5 rounded-full text-[14px] text-ink-300 hover:text-ink-100" onClick={close}>Not now</button>
        <button type="button" className="min-h-[44px] px-5 rounded-full text-[14px] btn-primary" onClick={go}>{data.button || 'OK'}</button>
      </div>
    </Sheet>
  );
}

export function VersionNotice() {
  const cfg = useClientConfig();
  const p = platform();
  const verdict = useMemo(() => versionVerdict(cfg?.versionPolicy, p, installedVersion()), [cfg?.versionPolicy, p]);
  const [snoozed, setSnoozed] = useState(() => getLocal<string>(VERSION_SNOOZE_KEY, '') === `${verdict.minVersion}|${today()}`);
  // Android: a forced update opens the in-app installer (mandatory, no "later").
  useEffect(() => {
    if (p !== 'android' || !verdict.force) return;
    void checkForUpdate({ manual: true }).then((info) => { if (info) useUpdateStore.getState().setInfo({ ...info, mandatory: true }); });
  }, [p, verdict.force]);
  if (!verdict.outdated) return null;
  const message = verdict.message || `This version of VinaX is out of date. Please update to ${verdict.minVersion} or newer.`;
  const action = p === 'web'
    ? <button type="button" className="min-h-[44px] px-5 rounded-full text-[14px] btn-primary" onClick={() => window.location.reload()}>Update now</button>
    : p === 'android'
      ? <button type="button" className="min-h-[44px] px-5 rounded-full text-[14px] btn-primary" onClick={() => void checkForUpdate({ manual: true }).then((info) => { if (info) useUpdateStore.getState().setInfo(verdict.force ? { ...info, mandatory: true } : info); })}>Update now</button>
      : null;
  if (verdict.force) {
    return (
      <div role="alertdialog" aria-modal="true" aria-labelledby="version-gate-title" className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-6">
        <div className="max-w-sm w-full rounded-2xl bg-ink-850 p-6 text-center">
          <h2 id="version-gate-title" className="text-[18px] font-bold text-ink-100">Update needed</h2>
          <p className="mt-2 text-[15px] text-ink-300">{message}</p>
          {action && <div className="mt-5 flex justify-center">{action}</div>}
        </div>
      </div>
    );
  }
  if (snoozed) return null;
  return (
    <div role="status" className="mb-3 flex items-center gap-3 rounded-xl bg-ink-850 px-3 py-2 text-[14px] text-ink-100">
      <p className="min-w-0 flex-1">{message}</p>
      {action}
      <button
        type="button"
        aria-label="Remind me tomorrow"
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-ink-300 hover:text-ink-100"
        onClick={() => { setLocal(VERSION_SNOOZE_KEY, `${verdict.minVersion}|${today()}`); setSnoozed(true); }}
      >
        <XIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
