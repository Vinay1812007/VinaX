import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { getSong } from '@/services/api';

/**
 * "Most played on VinaX this week" — the Worker's public chart
 * (GET /api/charts/vinax: plays shared by signed-in listeners over 7 days,
 * only songs at least five accounts played, kept three hours on the edge).
 * The chart carries ids, titles, artists and art; the songs themselves come
 * from the catalogue, so they play, and pass the listener's safety rules
 * (useShelfSafety) on their full records.
 *
 * Imported only by the lazy Charts and /top-songs pages.
 */

export interface ChartRow {
  id: string;
  title: string;
  artist: string;
  image: string | null;
  rank: number;
}

/** Fewer songs than this (after the listener's safety rules) and the chart is not shown. */
export const MIN_CHART_SONGS = 10;
/** How many chart songs are looked up in the catalogue. */
export const CHART_RESOLVE = 20;
const CHART_STALE_MS = 3 * 60 * 60_000;
const ENDPOINT = isNativePlatform() ? 'https://www.vinaxmusic.online/api/charts/vinax' : '/api/charts/vinax';

/** The route's answer → rows in rank order; anything malformed is left out. */
export function parseChart(json: unknown): ChartRow[] {
  const raw = json && typeof json === 'object' ? (json as { songs?: unknown }).songs : null;
  if (!Array.isArray(raw)) return [];
  const rows: ChartRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || typeof o.title !== 'string' || !o.title) continue;
    rows.push({
      id: o.id,
      title: o.title,
      artist: typeof o.artist === 'string' ? o.artist : '',
      image: typeof o.image === 'string' && o.image.startsWith('https://') ? o.image : null,
      rank: typeof o.rank === 'number' ? o.rank : rows.length + 1,
    });
  }
  return rows.sort((a, b) => a.rank - b.rank);
}

/**
 * The catalogue records of the first `limit` rows, in chart order, a few at a
 * time. A song the catalogue cannot find is left out.
 */
export async function resolveChartSongs(
  rows: ChartRow[],
  lookup: (id: string, signal?: AbortSignal) => Promise<Song>,
  limit = CHART_RESOLVE,
  signal?: AbortSignal,
): Promise<Song[]> {
  const picked = rows.slice(0, limit);
  const out: Array<Song | null> = new Array(picked.length).fill(null);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < picked.length && !signal?.aborted) {
      const i = next;
      next += 1;
      try {
        out[i] = await lookup(picked[i].id, signal);
      } catch {
        out[i] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, picked.length) }, worker));
  return out.filter((s): s is Song => !!s);
}

async function fetchChartSongs(signal?: AbortSignal): Promise<Song[]> {
  const res = await fetch(ENDPOINT, { headers: { accept: 'application/json' }, signal });
  if (!res.ok) throw new Error(`chart ${res.status}`);
  const rows = parseChart(await res.json());
  // Too short to be a chart: no catalogue lookups at all.
  if (rows.length < MIN_CHART_SONGS) return [];
  return resolveChartSongs(rows, (id, s) => getSong(id, { signal: s, priority: 'background' }), CHART_RESOLVE, signal);
}

/** The chart's songs (empty when too few listeners played enough songs this week). Filter with useShelfSafety, then check MIN_CHART_SONGS. */
export function useVinaxChart(enabled = true) {
  return useQuery<Song[]>({
    queryKey: ['vinax-chart'],
    queryFn: ({ signal }) => fetchChartSongs(signal),
    enabled,
    staleTime: CHART_STALE_MS,
    gcTime: 2 * CHART_STALE_MS,
    retry: false,
  });
}
