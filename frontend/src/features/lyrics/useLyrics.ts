import { useQuery } from '@tanstack/react-query';
import { getLyrics } from '@/services/api';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Lyrics availability varies wildly across wrappers — treat absence as a
 * normal state, not an error worth surfacing loudly.
 */
export function useLyrics(id: string | undefined) {
  const script = useSettingsStore((s) => s.lyricsScript);
  return useQuery({
    queryKey: ['lyrics', id, script],
    queryFn: () => getLyrics(id!, { script }),
    enabled: !!id,
    retry: false,
  });
}
