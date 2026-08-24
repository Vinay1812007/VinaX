import { useQuery } from '@tanstack/react-query';
import { getPlaylist } from '@/services/api';

export function usePlaylist(id: string | undefined) {
  return useQuery({
    queryKey: ['playlist', id],
    queryFn: () => getPlaylist(id!),
    enabled: !!id,
  });
}
