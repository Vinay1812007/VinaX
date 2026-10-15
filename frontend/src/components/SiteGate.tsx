import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isNativePlatform } from '@/services/native';

interface SiteMode {
  mode?: string;
  note?: string;
}

/** Admin-controlled kill switch: when the console sets Maintenance, listeners
 *  see a friendly "be right back" screen that re-checks every minute. */
export function SiteGate({ children }: { children: ReactNode }) {
  const q = useQuery<SiteMode>({
    queryKey: ['site-mode'],
    enabled: typeof window !== 'undefined',
    // 13.5.0 — every open tab asked once a minute (60 Worker requests an
    // hour each, ~1,440 a day) to catch a switch that is almost never on.
    // Now: once on load, then every 30 minutes; while the site IS in
    // maintenance it still re-checks every minute, so listeners come back
    // as soon as the owner turns it off.
    staleTime: 25 * 60_000,
    refetchInterval: (query) => (query.state.data?.mode === 'maintenance' ? 60_000 : 30 * 60_000),
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const base = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';
      const r = await fetch(`${base}/api/site-mode`);
      return r.ok ? ((await r.json()) as SiteMode) : { mode: 'live' };
    },
  });
  if (q.data?.mode !== 'maintenance') return <>{children}</>;
  return (
    <div className="h-dvh flex flex-col items-center justify-center gap-5 px-6 text-center bg-ink-950">
      <img src="/icons/icon.svg" alt="VinaX" className="w-14 h-14 rounded-2xl" />
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
