import { useQuery } from '@tanstack/react-query';
import { getLyrics } from '@/services/api';

/**
 * Lyrics availability varies wildly across wrappers — treat absence as a
 * normal state, not an error worth surfacing loudly.
 */
export function useLyrics(id: string | undefined) {
  return useQuery({
    queryKey: ['lyrics', id],
    queryFn: () => getLyrics(id!),
    enabled: !!id,
    retry: false,
  });
}
