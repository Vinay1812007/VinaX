/**
 * Ranking: every candidate gets an additive score whose terms are kept as
 * reasons, then a greedy re-rank keeps a list varied. The exposure penalty
 * and its cooling windows are the device's
 * (frontend/src/services/recommendation/exposure.ts), so the server never
 * repeats what the device just showed and the other way round.
 */
import type { PersonalWeights } from './config';
import { squash } from './taste';
import type { Candidate, CandidateSource, ExposureRow, Reason, Scored, SongRow, Taste } from './types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Penalty per exposure event, fading to zero over the horizon; cooling is the window a song stays at the back. */
const EXPOSURE: Readonly<Record<'shown' | 'queued' | 'played' | 'completed' | 'skipped' | 'disliked', { penalty: number; horizonMs: number; coolingMs: number }>> = {
  shown: { penalty: 0.14, horizonMs: 3 * DAY_MS, coolingMs: 12 * HOUR_MS },
  queued: { penalty: 0.24, horizonMs: 7 * DAY_MS, coolingMs: 2 * DAY_MS },
  played: { penalty: 0.3, horizonMs: 10 * DAY_MS, coolingMs: 3 * DAY_MS },
  completed: { penalty: 0.22, horizonMs: 14 * DAY_MS, coolingMs: 3 * DAY_MS },
  skipped: { penalty: 0.3, horizonMs: 21 * DAY_MS, coolingMs: 14 * DAY_MS },
  disliked: { penalty: 0.8, horizonMs: 60 * DAY_MS, coolingMs: 45 * DAY_MS },
};
const LIKED_FORGIVENESS = 0.25;
const RECENT_PLAY_GUARD_MS = 72 * HOUR_MS;

export interface Exposure { penalty: number; cooling: boolean; recentlyPlayed: boolean; disliked: boolean }

const ms = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

/** What an exposure row costs a song now. */
export function exposureOf(row: ExposureRow | undefined, now: number): Exposure {
  if (!row) return { penalty: 0, cooling: false, recentlyPlayed: false, disliked: false };
  let penalty = 0;
  let cooling = false;
  const add = (kind: keyof typeof EXPOSURE, last: number, times = 1) => {
    if (!last) return;
    const age = Math.max(0, now - last);
    const spec = EXPOSURE[kind];
    penalty += spec.penalty * Math.min(3, Math.max(1, times)) * Math.max(0, 1 - age / spec.horizonMs);
    if (age < spec.coolingMs) cooling = true;
  };
  add('shown', ms(row.last_shown));
  add('queued', ms(row.last_queued));
  add('played', ms(row.last_played));
  add('completed', ms(row.last_completed));
  add('skipped', ms(row.last_skipped), row.skipped);
  if (row.disliked) add('disliked', ms(row.last_skipped) || ms(row.last_played) || now);
  if (row.liked) penalty *= LIKED_FORGIVENESS;
  const lastPlayed = ms(row.last_played);
  return { penalty, cooling, recentlyPlayed: lastPlayed > 0 && now - lastPlayed < RECENT_PLAY_GUARD_MS, disliked: row.disliked };
}

/** Cosine similarity (as embedding models give it) to a 0..1 fit. */
export const simToFit = (sim: number): number => Math.max(0, Math.min(1, (sim - 0.2) / 0.7));

const SOURCE_BOOST: Readonly<Record<'taste' | 'seed', Record<CandidateSource, number>>> = {
  taste: { neighbours: 0.9, similar: 0.8, colisten: 0.8, artist: 0.7, own: 0.6, trending: 0.5, search: 0.7 },
  seed: { similar: 1, neighbours: 0.8, colisten: 0.8, artist: 0.6, own: 0.4, trending: 0.3, search: 0.7 },
};

export interface ScoreContext {
  taste: Taste;
  exposure: ReadonlyMap<string, ExposureRow>;
  weights: PersonalWeights;
  now: number;
  /** The listener's local hour, when the device said. */
  hour: number | null;
  /** `seed` ranks around one song, `taste` around the model. */
  intent: 'taste' | 'seed';
  /** The largest co-listening weight in the pool, to scale that term. */
  maxColisten: number;
}

function artistKeys(song: SongRow): string[] {
  const keys: string[] = [];
  if (song.artist_id) keys.push(song.artist_id);
  if (song.artist) keys.push(`name:${song.artist.toLowerCase()}`);
  return keys;
}

export function scoreOne(song: SongRow, c: Candidate, ctx: ScoreContext): Scored {
  const { taste, weights: w } = ctx;
  const reasons: Reason[] = [];
  const push = (kind: string, weight: number) => { if (weight !== 0) reasons.push({ kind, weight }); };

  if (typeof c.similarity === 'number') push('taste-fit', w.tasteFit * simToFit(c.similarity));

  const artist = artistKeys(song).map((k) => taste.artists[k]).find(Boolean);
  const artistFit = artist ? squash(artist.score) : 0;
  push('artist', w.artist * artistFit);

  const lang = song.language ? taste.languages[song.language.toLowerCase()] : undefined;
  push('language', w.language * (lang ? squash(lang.score) : 0));

  if (typeof c.colisten === 'number' && ctx.maxColisten > 0) push('co-listen', w.colisten * Math.min(1, c.colisten / ctx.maxColisten));

  let boost = 0;
  for (const s of c.sources) boost = Math.max(boost, SOURCE_BOOST[ctx.intent][s]);
  if (typeof c.rank === 'number') boost *= Math.max(0.5, 1 - c.rank / 40);
  push('source', w.source * boost);
  push('agreement', w.agreement * Math.min(1, (c.sources.size - 1) * 0.5));

  if (ctx.hour !== null) {
    const bucket = (song.language && taste.hours[song.language.toLowerCase()]) || taste.hours._all;
    const peak = bucket ? Math.max(...bucket) : 0;
    if (bucket && peak > 0) push('hour', w.hour * (bucket[ctx.hour] / peak));
  }

  const year = song.year ?? 0;
  const thisYear = new Date(ctx.now).getUTCFullYear();
  let fresh = year >= thisYear - 1 ? 1 : year >= thisYear - 3 ? 0.5 : 0;
  if (ctx.now - (Date.parse(song.first_seen) || ctx.now) < 14 * DAY_MS) fresh = Math.min(1, fresh + 0.5);
  push('fresh', w.freshness * fresh);

  push('community', w.community * Math.min(1, Math.log1p(song.plays || 0) / Math.log1p(10_000)));

  const x = exposureOf(ctx.exposure.get(song.id), ctx.now);
  push('exposure', -w.exposure * x.penalty);
  if (x.recentlyPlayed) push('recent-play', -0.5);

  const songAff = taste.songs[song.id];
  const skips = Math.max(artist?.skips ?? 0, songAff?.skips ?? 0);
  push('skips', -w.skips * Math.min(1, skips / 5));

  const known = artistFit > 0.15;
  if (taste.mode === 'familiar') push('novelty', w.novelty * (known ? 1 : -1));
  else if (taste.mode === 'discover') push('novelty', w.novelty * (known ? -0.5 : 1));

  const score = reasons.reduce((s, r) => s + r.weight, 0);
  return { song, candidate: c, score, reasons, cooling: x.cooling || x.disliked };
}

/** Score a pool; disliked songs and those with a score at or below zero are dropped. */
export function scorePool(pool: ReadonlyMap<string, Candidate>, songs: ReadonlyMap<string, SongRow>, ctx: Omit<ScoreContext, 'maxColisten'>): Scored[] {
  let maxColisten = 0;
  for (const c of pool.values()) if (typeof c.colisten === 'number') maxColisten = Math.max(maxColisten, c.colisten);
  const full: ScoreContext = { ...ctx, maxColisten };
  const out: Scored[] = [];
  for (const c of pool.values()) {
    const song = songs.get(c.id);
    if (!song) continue;
    if (ctx.exposure.get(song.id)?.disliked) continue;
    const s = scoreOne(song, c, full);
    if (s.score > 0) out.push(s);
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface RerankOptions {
  limit: number;
  /** An artist appears at most this often (default 3). */
  artistCap?: number;
  /** Songs already placed elsewhere on the page (identity keys and ids), never repeated. */
  claimed?: ReadonlySet<string>;
  /** Cooling songs are kept, after everything else (default) — or dropped. */
  dropCooling?: boolean;
}

const overlap = (a: SongRow, b: SongRow): number => {
  let n = 0;
  if (a.artist_id && a.artist_id === b.artist_id) n += 1;
  else if (a.artist.toLowerCase() === b.artist.toLowerCase()) n += 1;
  if (a.album_id && a.album_id === b.album_id) n += 0.5;
  if (a.language && a.language === b.language) n += 0.25;
  return n;
};

/**
 * Greedy, maximal-marginal-relevance style: each pick is the best score
 * minus a diversity cost against the last four picks; one recording per
 * identity family; an artist never twice in a row and at most `artistCap`
 * times; cooling songs only once nothing else is left.
 */
export function rerank(scored: readonly Scored[], o: RerankOptions): Scored[] {
  const cap = o.artistCap ?? 3;
  const claimed = o.claimed ?? new Set<string>();
  const pick = (from: Scored[], out: Scored[], keys: Set<string>, artists: Map<string, number>) => {
    const remaining = from.slice();
    while (out.length < o.limit && remaining.length) {
      let bestI = -1;
      let best = -Infinity;
      for (let i = 0; i < remaining.length; i += 1) {
        const s = remaining[i];
        const akey = s.song.artist_id ?? `name:${s.song.artist.toLowerCase()}`;
        if (keys.has(s.song.key) || keys.has(s.song.id) || claimed.has(s.song.key) || claimed.has(s.song.id)) { remaining.splice(i, 1); i -= 1; continue; }
        if ((artists.get(akey) ?? 0) >= cap) { remaining.splice(i, 1); i -= 1; continue; }
        const last = out[out.length - 1];
        if (last && (last.song.artist_id ?? `name:${last.song.artist.toLowerCase()}`) === akey && remaining.length > 1) continue;
        let cost = 0;
        for (const prev of out.slice(-4)) cost += overlap(s.song, prev.song);
        const utility = s.score - 0.12 * cost;
        if (utility > best) { best = utility; bestI = i; }
      }
      if (bestI < 0) break;
      const [chosen] = remaining.splice(bestI, 1);
      out.push(chosen);
      keys.add(chosen.song.key);
      keys.add(chosen.song.id);
      const akey = chosen.song.artist_id ?? `name:${chosen.song.artist.toLowerCase()}`;
      artists.set(akey, (artists.get(akey) ?? 0) + 1);
    }
  };
  const out: Scored[] = [];
  const keys = new Set<string>();
  const artists = new Map<string, number>();
  pick(scored.filter((s) => !s.cooling), out, keys, artists);
  if (!o.dropCooling && out.length < o.limit) pick(scored.filter((s) => s.cooling), out, keys, artists);
  return out;
}

/** The strongest positive reason, as a short line for a shelf or a song. */
export function reasonLine(s: Scored): string | undefined {
  const top = [...s.reasons].filter((r) => r.weight > 0.02).sort((a, b) => b.weight - a.weight)[0];
  switch (top?.kind) {
    case 'taste-fit': return 'Close to what you play';
    case 'artist': return `Because you listen to ${s.song.artist}`;
    case 'language': return s.song.language ? `In ${s.song.language}, like most of your plays` : undefined;
    case 'co-listen': return 'Listeners like you play this';
    case 'source': return s.candidate.sources.has('similar') ? 'Similar to a song you liked' : s.candidate.sources.has('trending') ? 'Popular this week' : undefined;
    case 'hour': return 'Fits this hour for you';
    case 'fresh': return 'New';
    case 'novelty': return s.candidate.sources.has('neighbours') ? 'Something new near your taste' : undefined;
    default: return undefined;
  }
}
