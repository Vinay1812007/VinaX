/**
 * Blend — a playlist from two listeners' likes, kept in the Library as
 * "Blend with <name>" and rebuilt when either side's likes change.
 *
 * Built on this device from plain catalogue lookups: their recent likes (the
 * at most twenty their public profile carries) and your favourites, each cut
 * into batches of five seeds (the most `/api/recommendations` takes), one
 * catalogue-ranked call per batch. The lists are interleaved so both sides
 * take turns, and every song remembers whose seeds brought it in. No AI.
 *
 * The playlist itself is an ordinary local playlist (it syncs with the
 * account like any other). What only this device needs — whose profile it is
 * for, when it was built, and where each song came from — is kept here.
 * Songs the listener adds to the playlist by hand stay through a refresh.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { useLibraryStore } from '@/store/libraryStore';
import { recommendFromSeeds } from '@/services/recs/similar';
import { resolveSongs } from '@/features/social/resolve';
import type { LiteSong, PublicProfile } from '@/services/social/api';

/** Whose seeds a song came from. `both`: it came from each side. */
export type BlendSource = 'theirs' | 'mine' | 'both';

export interface BlendRecord {
  handle: string;
  /** Their name when the blend was made (the playlist is "Blend with <name>"). */
  name: string;
  collectionId: string;
  /** Their profile's `updatedAt` when it was last built. */
  theirsAt: string;
  /** Their seed likes when it was last built (ids, joined). `updatedAt` moves
   *  with every "now playing" send, so this, not the time, says: rebuild. */
  theirsKey?: string;
  /** Your seed songs when it was last built (ids, joined). */
  mineKey: string;
  builtAt: number;
  from: Record<string, BlendSource>;
}

export interface BlendResult {
  songs: Song[];
  from: Record<string, BlendSource>;
}

/** The recommendation route's seed cap. */
export const SEEDS_PER_CALL = 5;
/** Catalogue calls per side (so ten seeds each). */
export const BATCHES_PER_SIDE = 2;
/** Songs each call asks for. */
export const PICKS_PER_CALL = 10;
/** How long the playlist gets. */
export const BLEND_MAX = 50;

/** Up to `batches` runs of `size` seeds, in order. Pure. */
export function seedBatches<T>(seeds: T[], batches = BATCHES_PER_SIDE, size = SEEDS_PER_CALL): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < batches; i++) {
    const b = seeds.slice(i * size, (i + 1) * size);
    if (b.length) out.push(b);
  }
  return out;
}

/** Take one from each list in turn until all are empty. Pure. */
export function roundRobin<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** The ids of your seed songs, as stored on the record (a change means: rebuild). */
export function mineKey(favorites: Song[]): string {
  return favorites.slice(0, SEEDS_PER_CALL * BATCHES_PER_SIDE).map((s) => s.id).join(',');
}

/** The ids of their seed likes (the first ones their profile carries), as stored on the record. */
export function theirsKey(recentLikes: LiteSong[] | undefined): string {
  return (Array.isArray(recentLikes) ? recentLikes : []).slice(0, SEEDS_PER_CALL * BATCHES_PER_SIDE).map((s) => s?.id).join(',');
}

/**
 * The playlist from both sides' likes and the picks each side's batches
 * brought back. Songs you both like lead; then the two sides take turns,
 * each side's own likes and picks interleaved. A song that turns up on both
 * sides is tagged `both`. `skip` leaves songs out (hidden songs and artists). Pure.
 */
export function mixBlend(input: { theirLikes: Song[]; myLikes: Song[]; theirPicks: Song[][]; myPicks: Song[][]; max?: number; skip?: (s: Song) => boolean }): BlendResult {
  const max = input.max ?? BLEND_MAX;
  const theirs = roundRobin([input.theirLikes, ...input.theirPicks]);
  const mine = roundRobin([input.myLikes, ...input.myPicks]);
  const theirIds = new Set(theirs.map((s) => s.id));
  const myIds = new Set(mine.map((s) => s.id));
  const myLikeIds = new Set(input.myLikes.map((s) => s.id));
  const shared = input.theirLikes.filter((s) => myLikeIds.has(s.id));
  const songs: Song[] = [];
  const from: Record<string, BlendSource> = {};
  // Each song once, in the first place it can go, so the turns stay even:
  // the shared lead, then their side, then yours without what theirs already has.
  const lead = new Set(shared.map((s) => s.id));
  const theirTurn = theirs.filter((s) => !lead.has(s.id));
  const myTurn = mine.filter((s) => !lead.has(s.id) && !theirIds.has(s.id));
  for (const s of [...shared, ...roundRobin([theirTurn, myTurn])]) {
    if (songs.length >= max) break;
    if (!s?.id || from[s.id] || input.skip?.(s)) continue;
    from[s.id] = theirIds.has(s.id) && myIds.has(s.id) ? 'both' : theirIds.has(s.id) ? 'theirs' : 'mine';
    songs.push(s);
  }
  return { songs, from };
}

export interface BlendDeps {
  resolve: (lite: LiteSong[], limit: number) => Promise<Song[]>;
  recommend: typeof recommendFromSeeds;
}

const realDeps: BlendDeps = { resolve: (lite, limit) => resolveSongs(lite, limit), recommend: recommendFromSeeds };

/**
 * Build the blend: their likes looked up in the catalogue, then one
 * recommendation call per batch of five seeds on each side, all at once.
 * A call that fails just brings nothing; the likes themselves still count.
 */
export async function buildBlend(theirLikes: LiteSong[], favorites: Song[], deps: BlendDeps = realDeps): Promise<BlendResult> {
  const wanted = SEEDS_PER_CALL * BATCHES_PER_SIDE;
  const theirs = (await deps.resolve(theirLikes, wanted).catch(() => [] as Song[])).slice(0, wanted);
  const mine = favorites.slice(0, wanted);
  const exclude = [...new Set([...theirs, ...mine].map((s) => s.id))];
  const ask = (seeds: Song[], languages?: string[]) => deps.recommend(seeds, { limit: PICKS_PER_CALL, exclude, ...(languages ? { languages } : {}) }).catch(() => [] as Song[]);
  // Their side is not held to your pinned languages: their taste is the point.
  const [theirPicks, myPicks] = await Promise.all([
    Promise.all(seedBatches(theirs).map((b) => ask(b, []))),
    Promise.all(seedBatches(mine).map((b) => ask(b))),
  ]);
  const lib = useLibraryStore.getState();
  return mixBlend({ theirLikes: theirs, myLikes: mine, theirPicks, myPicks, skip: (s) => lib.isHidden(s.id) || lib.isArtistHidden(s) });
}

// ------------------------------------------------------------------ store

interface BlendState {
  blends: Record<string, BlendRecord>;
  put(rec: BlendRecord): void;
  drop(handle: string): void;
}

export const useBlendStore = create<BlendState>()(
  persist(
    (set, get) => ({
      blends: {},
      put: (rec) => set({ blends: { ...get().blends, [rec.handle]: rec } }),
      drop: (handle) => {
        const next = { ...get().blends };
        delete next[handle];
        set({ blends: next });
      },
    }),
    {
      name: KEYS.blends,
      partialize: (s) => ({ blends: s.blends }),
      // Untrusted storage: keep only records that look like records.
      merge: (persisted, current) => {
        const raw = (persisted as { blends?: unknown } | null)?.blends;
        const blends: Record<string, BlendRecord> = {};
        if (raw && typeof raw === 'object') {
          for (const [k, v] of Object.entries(raw as Record<string, Partial<BlendRecord>>)) {
            if (v && typeof v.handle === 'string' && typeof v.collectionId === 'string' && v.from && typeof v.from === 'object') blends[k] = v as BlendRecord;
          }
        }
        return { ...current, blends };
      },
    },
  ),
);

/** The blend with `handle`, while its playlist is still in the Library. */
export function blendFor(handle: string, blends = useBlendStore.getState().blends, collections = useLibraryStore.getState().collections): BlendRecord | null {
  const rec = blends[handle];
  return rec && collections.some((c) => c.id === rec.collectionId) ? rec : null;
}

/**
 * True when their likes or yours changed since the blend was built. Their
 * profile's `updatedAt` alone is not enough: it also moves every few minutes
 * while they share what they play, and that changes nothing in the blend.
 */
export function needsRefresh(rec: BlendRecord, profile: Pick<PublicProfile, 'updatedAt' | 'recentLikes'>, favorites: Song[]): boolean {
  if (rec.mineKey !== mineKey(favorites)) return true;
  if (rec.theirsAt === profile.updatedAt) return false;
  return rec.theirsKey !== theirsKey(profile.recentLikes);
}

export const blendName = (name: string): string => `Blend with ${name}`;

/**
 * Keep the blend in the Library: the playlist's songs become `result`'s, plus
 * any the listener added by hand. A first blend creates the playlist (signed
 * out visitors get the sign-in sheet and nothing is saved: null).
 */
export function saveBlend(profile: Pick<PublicProfile, 'handle' | 'name' | 'updatedAt'> & { recentLikes?: LiteSong[] }, result: BlendResult, favorites: Song[], now = Date.now()): BlendRecord | null {
  const lib = useLibraryStore.getState();
  const name = profile.name ?? profile.handle;
  const had = blendFor(profile.handle);
  let id = had?.collectionId ?? '';
  if (!id) {
    id = lib.createCollection(blendName(name));
    if (!id) return null;
    lib.updateCollectionMeta(id, { description: `Built from your likes and @${profile.handle}'s. It refreshes when either of you likes something new and you open their profile.` });
    lib.setCollectionTags(id, ['blend']);
  }
  const kept = new Set(result.songs.map((s) => s.id));
  useLibraryStore.setState((s) => ({
    collections: s.collections.map((c) => {
      if (c.id !== id) return c;
      // Added by hand: in the playlist, but never one of the blend's own picks.
      const byHand = c.songs.filter((x) => !kept.has(x.id) && !had?.from[x.id]);
      return { ...c, songs: [...result.songs, ...byHand] };
    }),
  }));
  const rec: BlendRecord = { handle: profile.handle, name, collectionId: id, theirsAt: profile.updatedAt, theirsKey: theirsKey(profile.recentLikes), mineKey: mineKey(favorites), builtAt: now, from: result.from };
  useBlendStore.getState().put(rec);
  return rec;
}
