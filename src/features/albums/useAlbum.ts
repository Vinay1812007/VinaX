import { useQuery } from '@tanstack/react-query';
import { getAlbum } from '@/services/api';

export function useAlbum(id: string | undefined) {
  return useQuery({
    queryKey: ['album', id],
    queryFn: () => getAlbum(id!),
    enabled: !!id,
  });
}
