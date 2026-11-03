import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isNativePlatform } from '@/services/native';
import { READ_ONLY_MESSAGE, setSiteMode } from '@/services/siteMode';

interface Upcoming {
  start?: string;
  end?: string;
  note?: string;
  warnFrom?: string;
}
interface SiteMode {
  mode?: string;
  note?: string;
  /** v8 — a planned maintenance window coming up. */
  upcoming?: Upcoming;
}

const ms = (iso?: string): number => (iso ? Date.parse(iso) : NaN);

/** "6:30 pm" (today) or "Tue, 6:30 pm" in the listener's own time. */
function at(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(undefined, { ...(sameDay ? {} : { weekday: 'short' }), hour: 'numeric', minute: '2-digit' });
}

/** Admin-controlled kill switch: when the console sets Maintenance, listeners
 *  see a friendly "be right back" screen that re-checks every minute.
 *  v8 — Read-only mode shows a banner (listening works, changes are not
 *  saved), and a planned maintenance window is announced before it starts. */
export function SiteGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const q = useQuery<SiteMode>({
    queryKey: ['site-mode'],
    enabled: typeof window !== 'undefined',
    // 13.5.0 — every open tab asked once a minute (60 Worker requests an
    // hour each, ~1,440 a day) to catch a switch that is almost never on.
    // Now: once on load, then every 30 minutes; while the site IS in
    // maintenance (or read-only) it re-checks every minute, so listeners come
    // back as soon as the owner turns it off.
    staleTime: 25 * 60_000,
    refetchInterval: (query) => (query.state.data?.mode === 'maintenance' || query.state.data?.mode === 'readonly' ? 60_000 : 30 * 60_000),
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const base = isNativePlatform() ? 'https://www.vinaxmusic.online' : '';
      const r = await fetch(`${base}/api/site-mode`);
      return r.ok ? ((await r.json()) as SiteMode) : { mode: 'live' };
    },
  });
  const mode = q.data?.mode;
  const up = q.data?.upcoming;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setSiteMode(mode); }, [mode]);

  // A planned window: wake up when the warning should appear and when the
  // window starts (then ask the server, which answers "maintenance").
  useEffect(() => {
    const marks = [ms(up?.warnFrom), ms(up?.start), ms(up?.end)].filter((t) => Number.isFinite(t) && t > Date.now());
    if (!marks.length) return undefined;
    const next = Math.min(...marks);
    const t = setTimeout(() => {
      setNow(Date.now());
      void client.invalidateQueries({ queryKey: ['site-mode'] });
    }, Math.min(next - Date.now() + 1_000, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [up?.warnFrom, up?.start, up?.end, now, client]);

  if (mode === 'maintenance') {
    return (
      <div className="h-dvh flex flex-col items-center justify-center gap-5 px-6 text-center bg-ink-950">
        <img src="/icons/icon.svg?v=14" alt="VinaX" className="w-14 h-14 rounded-2xl" />
        <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">We&rsquo;ll be right back</h1>
        <p className="-mt-2 max-w-sm text-[15px] text-ink-300 leading-relaxed">
          {q.data?.note?.trim() || 'VinaX is getting a quick tune-up. Your music, favorites and downloads are safe on your device.'}
        </p>
        <span className="vx-dots inline-flex items-center gap-1 text-ink-400" role="status" aria-label="Waiting">
          <i />
          <i />
          <i />
        </span>
        <p className="text-[13px] text-ink-400">This page checks again on its own.</p>
      </div>
    );
  }

  const warnFrom = ms(up?.warnFrom);
  const start = ms(up?.start);
  const warning = up && Number.isFinite(warnFrom) && Number.isFinite(start) && now >= warnFrom && now < start;
  const banner = mode === 'readonly'
    ? q.data?.note?.trim() || READ_ONLY_MESSAGE
    : warning
      ? `VinaX goes into maintenance at ${at(up!.start!)}.${up?.note?.trim() ? ` ${up.note.trim()}` : ' Music may stop for a little while.'}`
      : null;
  if (!banner) return <>{children}</>;
  return (
    <>
      {children}
      {/* A slim notice floating over the top of the app (the shell is a fixed
          full-height layout, so a banner in the flow would push it off screen). */}
      <div
        role="status"
        aria-live="polite"
        className="fixed left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+8px)] z-[70] flex items-center gap-2.5 w-max max-w-[min(92vw,560px)] rounded-xl bg-ink-850 px-4 py-2 text-[13px] leading-snug text-ink-200 shadow-lg pointer-events-none"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" aria-hidden />
        <span className="min-w-0">{banner}</span>
      </div>
    </>
  );
}
