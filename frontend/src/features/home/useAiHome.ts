import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs, searchSongsPage } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { freshSongs } from '@/services/recommendation/freshness';
import { servedKeySet } from '@/services/recommendation/songIdentity';
import { softMutedArtist } from '@/services/recommendation/profiles';
import { loadProfile } from '@/services/personalization/storage';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import { useDiscoveryStore } from '@/store/discoveryStore';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { designHomeShelves, loadShownSongIds, recordShownShelves, recordShownSongs, type AiShelfDefinition } from '@/services/ai/home';
import { biasUnseenFirst, rotatePage } from './homeVariety';
import { useShelfSafety } from './useShelfSafety';
import { HOME_TTL_MS, useHomeGeneration } from './homeRefresh';

/**
 * v6.2.0 / v6.4.0 / v6.5.0 — "Designed for you": the AI designs titled
 * shelves (services/ai/home.ts) and each one is resolved against the real
 * catalogue here. Each shelf's query reads a rotated catalogue page, and
 * songs this listener was shown recently sink below unseen ones; the model is
 * steered away from the last 30 shelf titles and the last 200 songs it
 * showed. Empty (the block renders nothing) when the AI is off, unconfigured
 * or slow — the ordinary shelves are unaffected.
 *
 * 9.0.0 — built once per Home GENERATION (./homeRefresh.ts), not once per
 * visit: 6.5 rebuilt on every open (a random nonce per mount, no stale time),
 * so returning to Home a minute later paid for another AI design and swapped
 * every shelf. The generation moves on an explicit refresh or when Home opens
 * after half an hour; the rotated pages follow it, so a new generation still
 * reads new pages.
 */
export interface AiShelf extends AiShelfDefinition {
  songs: Song[];
}

const MIN_SONGS = 4;
const PAGE_SIZE = 18;
const ROTATE_PAGES = 3;

/** A generation's rotation salt: deterministic, so the same generation reads the same pages. */
const generationNonce = (gen: number): number => (gen * 7919) % 1_000_000;

/** One shelf's catalogue read for this visit: a rotated page, with page 1 as the floor when it runs thin. */
async function fetchShelfSongs(query: string, page: number, signal?: AbortSignal): Promise<Song[]> {
  const first = page > 1 ? await searchSongsPage(query, page, PAGE_SIZE, { signal }).catch(() => [] as Song[]) : [];
  if (first.length >= MIN_SONGS * 2) return first;
  const base = await searchSongs(query, PAGE_SIZE, { signal });
  const seen = new Set(first.map((s) => s.id));
  return [...first, ...base.filter((s) => !seen.has(s.id))];
}

const fold = (s: string): string => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * 8.0.0 — a shelf keeps only songs that belong on it: in the shelf's language
 * (a song with no known language is kept only when the shelf has none), and,
 * for an artist shelf, crediting that singer. Measured live, an
 * unchecked query put Tamil, Malayalam and instrumental tracks on a Telugu
 * listener's shelf.
 */
export function belongsOnShelf(song: Song, shelf: Pick<AiShelfDefinition, 'language' | 'kind' | 'subject'>): boolean {
  const lang = (song.language ?? '').toLowerCase();
  if (shelf.language) {
    if (!lang || lang === 'unknown' || lang !== shelf.language) return false;
  }
  // Singers are credited on the song; a music director usually is not, so composer shelves are checked for language only.
  if (shelf.kind === 'artist' && shelf.subject) {
    const want = fold(shelf.subject);
    const credits = fold([...song.artists.map((a) => a.name), song.subtitle].join(' '));
    if (!want || !credits.includes(want)) return false;
  }
  return true;
}

export async function designAndResolve(signal?: AbortSignal, visitNonce = generationNonce(1)): Promise<AiShelf[]> {
  const sections = await designHomeShelves(signal, visitNonce);
  if (!sections.length) return [];
  const settings = useSettingsStore.getState();
  const lib = useLibraryStore.getState();
  const softMuted = loadProfile().softMuted;
  const served = servedKeySet();
  const shownBefore = new Set(loadShownSongIds());
  const results = await Promise.allSettled(sections.map((s, i) => fetchShelfSongs(s.query, rotatePage(s.query, visitNonce, i, ROTATE_PAGES), signal)));
  const seenIds = new Set<string>();
  const shelves: AiShelf[] = [];
  sections.forEach((section, i) => {
    const r = results[i];
    if (r.status !== 'fulfilled') return;
    const ranked = rankSongs(r.value).filter((song) => belongsOnShelf(song, section));
    // Songs not shown on AI shelves recently come first; shown ones only fill up.
    // (rankSongs has already dropped explicit songs in Kid mode.) The hook re-applies all of this on render.
    const admitted = freshSongs(ranked, { excludeIds: seenIds, excludeKeys: served, muted: settings.mutedLanguages, blocked: (s) => isSongBlocked(s, lib) || softMutedArtist(s, softMuted) });
    const songs = biasUnseenFirst(admitted, shownBefore).slice(0, 12);
    if (songs.length < MIN_SONGS) return;
    songs.forEach((s) => seenIds.add(s.id));
    shelves.push({ ...section, songs });
  });
  if (shelves.length) {
    recordShownShelves(shelves);
    recordShownSongs(shelves.flatMap((s) => s.songs));
  }
  return shelves;
}

export interface AiHomeResult {
  /** The shelves, with the listener's CURRENT safety settings applied (see ./useShelfSafety). */
  data: AiShelf[] | undefined;
  isLoading: boolean;
  /** The previous design, shown while a new one is on its way. */
  isPlaceholderData: boolean;
}

export function useAiHome(enabled: boolean): AiHomeResult {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const on = useSettingsStore((s) => s.aiHomeShelves);
  const round = useDiscoveryStore((s) => s.round);
  const hasTaste = useHistoryStore((s) => s.entries.length > 0);
  const allowed = useShelfSafety();
  const gen = useHomeGeneration();
  const query = useQuery<AiShelf[]>({
    // v7.0.0 — the profile stamp is NOT in the key: it changes on every play,
    // skip and like, and each change used to throw the shelves away and spend
    // another design call while Home was simply open.
    // 7.2.0 — safety settings (Kid mode, muted languages, hidden songs and
    // artists, soft mutes) are NOT in the key either: they are applied below,
    // on every render, to cached and placeholder shelves alike, so a newly
    // forbidden song disappears at once without another design call.
    // 9.0.0 — one design per Home generation (refresh or half an hour), plus
    // the settings that change what should be designed.
    queryKey: ['ai-home-shelves', gen, pinned, round],
    enabled: enabled && on && (hasTaste || pinned.length > 0),
    staleTime: HOME_TTL_MS,
    gcTime: 2 * HOME_TTL_MS,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: ({ signal }) => designAndResolve(signal, generationNonce(gen)),
  });
  // Every render, not memoised: the server blocklist is not a store, so the
  // next render after it loads must see it (a few dozen songs at most).
  const data = query.data?.map((shelf) => ({ ...shelf, songs: shelf.songs.filter(allowed) })).filter((shelf) => shelf.songs.length >= MIN_SONGS);
  return { data, isLoading: query.isLoading, isPlaceholderData: query.isPlaceholderData };
}
