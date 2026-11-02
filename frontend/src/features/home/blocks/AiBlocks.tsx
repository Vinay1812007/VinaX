import { useQuery } from '@tanstack/react-query';
import { ShelfSkeleton } from '@/components/Skeletons';
import { getSongSuggestions, searchSongs } from '@/services/api';
import { dedupeByIdentity } from '@/services/recommendation/songIdentity';
import { isJunkTrack } from '@/services/recommendation/quality';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import type { HomeLayoutBlock } from '@/services/home/homeBuilder';
import type { Song } from '@/types';
import { HOME_TTL_MS, useHomeGeneration } from '../homeRefresh';
import { markShelfNotInterested } from '../homeAiPrefs';
import { useShelfDedupe } from '../shelfLedger';
import { SongShelf, useShelfLens } from './shared';

/**
 * 1.4 — the AI Home Builder's pieces on Home.
 *
 * `AiShelfHead` puts the AI's title and its one-line "why" over a block it
 * chose, with "Not interested" (the shelf stays away from the next build on;
 * nothing moves now). `RightNowBlock` is the AI's own shelf: the AI says what
 * feeds it (a plain search phrase, a mood and a language, or seeds the device
 * offered); the songs come from the catalogue and go through the same lens and
 * shelf ledger as every other Home shelf.
 */

function NotInterested({ type, title }: { type: HomeLayoutBlock['type']; title: string }) {
  return (
    <button
      type="button"
      className="vxh-pill is-quiet vxh-ai-notint"
      onClick={() => {
        markShelfNotInterested(type);
        toast(`Got it — "${title}" stays off your next Home. Bring it back in Settings → Home.`, { key: 'home-not-interested' });
      }}
    >
      Not interested
    </button>
  );
}

export function AiShelfHead({ block }: { block: HomeLayoutBlock }) {
  return (
    <div className="vxh-ai-head">
      <div className="vxh-ai-text">
        <h2 className="vxh-ai-title">{block.title}</h2>
        <p className="vxh-ai-why">{block.reason}</p>
      </div>
      <NotInterested type={block.type} title={block.title} />
    </div>
  );
}

const MOOD_WORD: Record<string, string> = { romantic: 'romantic', energetic: 'party', chill: 'chill', melancholy: 'sad', devotional: 'devotional', party: 'party', focus: 'focus', happy: 'feel good', sad: 'sad', calm: 'calm' };

/** The search the shelf runs: the AI's phrase, else its mood, in its language or the listener's first. */
export function rightNowQuery(block: Pick<HomeLayoutBlock, 'query' | 'mood' | 'language'>, fallbackLanguage: string | null): string | null {
  const language = block.language ?? fallbackLanguage ?? '';
  const phrase = block.query ?? (block.mood ? `${MOOD_WORD[block.mood] ?? block.mood} songs` : null);
  return phrase ? `${language} ${phrase}`.trim() : null;
}

export function RightNowBlock({ block, seeds }: { block: HomeLayoutBlock; seeds: ReadonlyMap<string, Song> }) {
  const generation = useHomeGeneration();
  const dedupe = useShelfDedupe('rightnow');
  const lens = useShelfLens();
  const firstLanguage = useSettingsStore((s) => s.pinnedLanguages[0] ?? null);
  const seedSongs = (block.seedIds ?? []).map((k) => seeds.get(k)).filter((s): s is Song => !!s);
  const query = rightNowQuery(block, firstLanguage);
  const songs = useQuery<Song[]>({
    queryKey: ['home-ai-rightnow', generation, query, seedSongs.map((s) => s.id).join(',')],
    staleTime: HOME_TTL_MS,
    gcTime: HOME_TTL_MS,
    queryFn: async ({ signal }) => {
      const lists = await Promise.all([
        ...seedSongs.map((s) => getSongSuggestions(s.id, 12, { signal }).catch(() => [] as Song[])),
        query ? searchSongs(query, 24, { signal }).catch(() => [] as Song[]) : Promise.resolve([] as Song[]),
      ]);
      // Interleave the lists so one seed cannot fill the shelf, then one copy of each song.
      const merged: Song[] = [];
      for (let i = 0; merged.length < 60 && lists.some((l) => l[i]); i += 1) for (const l of lists) if (l[i]) merged.push(l[i]);
      const seedIds = new Set(seedSongs.map((s) => s.id));
      return dedupeByIdentity(merged.filter((s) => s?.id && !seedIds.has(s.id) && !isJunkTrack(s)), (s) => s).slice(0, 20);
    },
  });
  if (songs.isLoading) return <ShelfSkeleton />;
  return <SongShelf title={block.title} explanation={block.reason} songs={dedupe(lens(songs.data, 'discovery'))} action={<NotInterested type={block.type} title={block.title} />} />;
}
