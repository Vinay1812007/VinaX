import { useQuery } from '@tanstack/react-query';
import { getSong, getSongSuggestions } from '@/services/api';

export function useSongDetails(id: string | undefined) {
  return useQuery({
    queryKey: ['song', id],
    queryFn: () => getSong(id!),
    enabled: !!id,
  });
}

export function useSongSuggestions(id: string | undefined) {
  return useQuery({
    queryKey: ['song-suggestions', id],
    queryFn: () => getSongSuggestions(id!, 12),
    enabled: !!id,
  });
}
