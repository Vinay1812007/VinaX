import { useQuery } from '@tanstack/react-query';
import { checkForUpdate } from '@/services/update';
import { isNativePlatform } from '@/services/native';

/** Home banner shown on Android when the site carries a newer version. */
export function UpdateBanner() {
  const { data } = useQuery({
    queryKey: ['update-check'],
    queryFn: checkForUpdate,
    enabled: isNativePlatform(),
    staleTime: 30 * 60_000,
    retry: false,
  });

  if (!data) return null;

  return (
    <div className="mb-5 rounded-2xl border border-ember-500/40 bg-ember-500/10 p-4 flex items-center gap-3 animate-fade-up">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Update available — v{data.latest}</p>
        <p className="text-xs text-ink-300 mt-0.5">You’re on v{data.current}. Install over the top, no uninstall needed.</p>
      </div>
      <a
        href={data.apkUrl}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 px-4 py-2 rounded-full text-sm btn-primary"
      >
        Download
      </a>
    </div>
  );
}
