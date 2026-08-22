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
    staleTime: 55_000,
    refetchInterval: 60_000,
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
      <img src="/icons/icon.svg" alt="VinaX" className="w-16 h-16 rounded-2xl" />
      <h1 className="text-2xl font-bold tracking-tight">
        We&rsquo;ll be right back<span className="text-ember-500">.</span>
      </h1>
      <p className="max-w-sm text-sm text-ink-300 leading-relaxed">
        {q.data?.note?.trim() || 'VinaX is getting a quick tune-up. Your music, favorites and downloads are safe on your device.'}
      </p>
      <span className="vx-dots inline-flex items-center gap-1 text-ink-400" role="status" aria-label="Waiting">
        <i />
        <i />
        <i />
      </span>
      <p className="text-[11px] text-ink-400">Checks again automatically — no need to refresh.</p>
    </div>
  );
}
