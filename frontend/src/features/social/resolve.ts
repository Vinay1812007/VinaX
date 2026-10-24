/**
 * 15.0 — the server keeps songs as a few display fields (services/social/api
 * `LiteSong`); playing one needs the catalogue's full record. `resolveSongs`
 * looks each id up (a handful at a time, cached by react-query at the
 * callers) and drops what the catalogue no longer has.
 */
import type { Song } from '@/types';
import { getSong } from '@/services/api/saavn';
import type { LiteSong } from '@/services/social/api';

export async function resolveSongs(lite: LiteSong[], limit = 50, signal?: AbortSignal): Promise<Song[]> {
  const ids = [...new Set(lite.map((s) => s.id).filter(Boolean))].slice(0, limit);
  const out: Song[] = [];
  for (let i = 0; i < ids.length; i += 6) {
    const batch = await Promise.all(ids.slice(i, i + 6).map((id) => getSong(id, { signal, priority: 'background' }).catch(() => null)));
    for (const s of batch) if (s) out.push(s);
  }
  return out;
}
