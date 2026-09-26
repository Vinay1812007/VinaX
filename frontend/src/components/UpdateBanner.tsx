import { useQuery } from '@tanstack/react-query';
import { checkForUpdate } from '@/services/update';
import { isNativePlatform } from '@/services/native';
import { useUpdateStore } from '@/store/updateStore';
import { DownloadIcon } from './Icons';

/** Home banner shown on Android when the site carries a newer version. It
 *  stays up through an "Update later", so the reminder is always one tap
 *  from the in-app installer. */
export function UpdateBanner() {
  const { data } = useQuery({
    queryKey: ['update-check'],
    queryFn: () => checkForUpdate({ manual: true }),
    enabled: isNativePlatform(),
    staleTime: 30 * 60_000,
    retry: false,
  });

  if (!data) return null;

  return (
    <div className="mb-6 flex items-center gap-3 min-h-[64px] rounded-xl bg-ink-850 pl-3 pr-2 py-2 animate-fade-up">
      <span className="w-10 h-10 rounded-full bg-ink-100/[0.07] text-ink-200 flex items-center justify-center shrink-0" aria-hidden>
        <DownloadIcon className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-ink-100">Update available — v{data.latest}</p>
        <p className="text-[13px] text-ink-400 truncate">You’re on v{data.current}. Installs over the top.</p>
      </div>
      <button
        onClick={() => useUpdateStore.getState().setInfo(data)}
        className="shrink-0 px-5 min-h-[44px] rounded-full text-[14px] btn-primary"
      >
        Update
      </button>
    </div>
  );
}
