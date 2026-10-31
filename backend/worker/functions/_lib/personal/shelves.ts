/**
 * The deterministic Home: up to twelve shelves from a scored pool, each
 * with a key, a working title, the reason it exists and up to SHELF_SIZE
 * songs. A song sits on one shelf — except that "Made for you", the hero,
 * may share songs with the "Because you…" and artist shelves, which are
 * about a seed rather than about the best of the pool. This page is what
 * the composer shapes, and what is served when the composer cannot answer.
 */
import { rerank, reasonLine } from './scoring';
import { toRecord } from './songs';
import { tasteLanguages, tasteTopArtistWithId } from './taste';
import type { Scored, Shelf, SongRow, Taste } from './types';

export const SHELF_SIZE = 20;
export const MIN_SHELF = 6;

const DAY_MS = 86_400_000;

const LANGUAGE_NAMES: Record<string, string> = {
  telugu: 'Telugu', hindi: 'Hindi', tamil: 'Tamil', kannada: 'Kannada', malayalam: 'Malayalam', english: 'English',
  punjabi: 'Punjabi', marathi: 'Marathi', bengali: 'Bengali', gujarati: 'Gujarati', bhojpuri: 'Bhojpuri', odia: 'Odia', assamese: 'Assamese', urdu: 'Urdu',
  te: 'Telugu', hi: 'Hindi', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', en: 'English', pa: 'Punjabi', mr: 'Marathi', bn: 'Bengali',
};
export const languageName = (id: string): string => LANGUAGE_NAMES[id.toLowerCase()] ?? id.charAt(0).toUpperCase() + id.slice(1);

export interface ShelfContext {
  taste: Taste;
  songs: ReadonlyMap<string, SongRow>;
  now: number;
  hour: number | null;
  isoWeek: string;
}

interface Draft { key: string; title: string; reason: string; picks: Scored[] }

function take(scored: readonly Scored[], claimed: Set<string>, limit = SHELF_SIZE, filter?: (s: Scored) => boolean, dropCooling = false, against: ReadonlySet<string> = claimed): Scored[] {
  const from = filter ? scored.filter(filter) : scored;
  const picks = rerank(from, { limit, claimed: against, dropCooling });
  for (const p of picks) { claimed.add(p.song.id); claimed.add(p.song.key); }
  return picks;
}

const hourWord = (h: number): string => (h < 5 ? 'Late night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night');

/** The shelves, in priority order; shelves with fewer than MIN_SHELF songs are left out. */
export function buildShelves(scored: readonly Scored[], ctx: ShelfContext): Shelf[] {
  const { taste, songs, now } = ctx;
  // Two ledgers: the hero's own picks, and everything the seed shelves took. The seed shelves
  // check only the second; every later shelf checks both.
  const hero = new Set<string>();
  const claimed = new Set<string>();
  const both = { has: (k: string) => hero.has(k) || claimed.has(k) } as ReadonlySet<string>;
  const drafts: Draft[] = [];
  const known = (s: Scored) => !!taste.songs[s.song.id];
  const unheard = (s: Scored) => !taste.songs[s.song.id] || taste.songs[s.song.id].plays === 0;

  drafts.push({ key: 'made-for-you', title: 'Made for you', reason: 'The best of everything the engine knows about you today', picks: take(scored, hero) });

  // because you played / liked X — two strongest recent seeds with similar songs in the pool
  const seeds = new Map<string, Scored[]>();
  for (const s of scored) if (s.candidate.seedId && s.candidate.sources.has('similar')) (seeds.get(s.candidate.seedId) ?? seeds.set(s.candidate.seedId, []).get(s.candidate.seedId)!).push(s);
  const seedOrder = [...seeds.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 2);
  for (const [seedId, list] of seedOrder) {
    const seed = songs.get(seedId);
    const picks = take(list, claimed, SHELF_SIZE, undefined, false, claimed);
    const liked = (taste.songs[seedId]?.likes ?? 0) > 0;
    drafts.push({
      key: `because:${seedId}`,
      title: seed ? `Because you ${liked ? 'liked' : 'played'} ${seed.title}` : 'More like what you played',
      reason: seed ? `Songs that go with ${seed.title} by ${seed.artist}` : 'Close to a song you played recently',
      picks,
    });
  }

  // one artist to go deeper into
  const artist = tasteTopArtistWithId(taste);
  if (artist) {
    const picks = take(scored, claimed, SHELF_SIZE, (s) => s.song.artist_id === artist.id || s.song.artist.toLowerCase() === artist.name.toLowerCase(), false, claimed);
    drafts.push({ key: `artist:${artist.id}`, title: `More from ${artist.name}`, reason: `One of the artists you play most`, picks });
  }

  // the top two languages
  for (const lang of tasteLanguages(taste, 2)) {
    const picks = take(scored, claimed, SHELF_SIZE, (s) => (s.song.language ?? '').toLowerCase() === lang, false, both);
    drafts.push({ key: `language:${lang}`, title: `${languageName(lang)} for you`, reason: `In ${languageName(lang)}, picked for your taste`, picks });
  }

  // discovery: never heard, from the vector or co-listening sources
  drafts.push({
    key: 'discover', title: 'Discover', reason: 'New to you, close to what you love',
    picks: take(scored, claimed, SHELF_SIZE, (s) => unheard(s) && (s.candidate.sources.has('neighbours') || s.candidate.sources.has('colisten')), true, both),
  });

  // rediscover: own songs not played for three weeks
  drafts.push({
    key: 'rediscover', title: 'Rediscover', reason: 'Songs you loved and have not played for a while',
    picks: take(scored, claimed, SHELF_SIZE, (s) => known(s) && now - taste.songs[s.song.id].last > 21 * DAY_MS, false, both),
  });

  // this hour
  if (ctx.hour !== null) {
    const hour = ctx.hour;
    drafts.push({
      key: 'hour', title: `${hourWord(hour)} picks`, reason: `What you tend to play around this time`,
      picks: take(scored, claimed, SHELF_SIZE, (s) => s.reasons.some((r) => r.kind === 'hour' && r.weight > 0.02), false, both),
    });
  }

  drafts.push({ key: 'community', title: 'Listeners like you', reason: 'What people with your taste are playing', picks: take(scored, claimed, SHELF_SIZE, (s) => s.candidate.sources.has('colisten'), false, both) });
  drafts.push({ key: 'trending', title: 'Popular this week', reason: 'Most played across VinaX in your languages', picks: take(scored, claimed, SHELF_SIZE, (s) => s.candidate.sources.has('trending'), false, both) });
  drafts.push({
    key: `new-this-week:${ctx.isoWeek}`, title: 'New to you this week', reason: 'A fresh set of unheard songs, kept for the week',
    picks: take(scored, claimed, SHELF_SIZE, (s) => unheard(s), true, both),
  });

  const out: Shelf[] = [];
  for (const d of drafts) {
    if (d.picks.length < MIN_SHELF) continue;
    out.push({ key: d.key, title: d.title, reason: d.reason, songs: d.picks.map((p) => toRecord(p.song, reasonLine(p))) });
  }
  return out;
}

/** 2026-W05 for the current UTC week. */
export function isoWeekOf(now: number): string {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The first shelf with songs, for a hero. */
export const heroOf = (shelves: readonly Shelf[]): Shelf | null => shelves.find((s) => s.songs.length >= MIN_SHELF) ?? null;

