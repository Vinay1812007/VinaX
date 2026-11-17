import type { Song } from '@/types';
import { timeOfDaySeed } from '@/constants/seeds';
import { languageLabel } from '@/constants/languages';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { explainMix } from './explanations';
import { dedupeByIdentity, songKey } from './songIdentity';
import { heardCheck } from './admission';
import { listenerFamiliarity } from './scoring';
import type { Mix, RecommendationContext, ScoredCandidate } from './types';

const MIX_SIZE = 20;
const MIN_MIX_SIZE = 4;
/** Your Week (/weekly) is the weekly discovery mix, at this length. */
export const WEEK_SIZE = 30;

function songsOf(list: ScoredCandidate[], n = MIX_SIZE): Song[] {
  return list.slice(0, n).map((s) => s.candidate.song);
}

function mix(
  id: string,
  kind: Mix['kind'],
  title: string,
  songs: Song[],
  ctx: RecommendationContext,
  detail?: string,
  size = MIX_SIZE,
): Mix | null {
  if (songs.length < MIN_MIX_SIZE) return null;
  return { id, kind, title, explanation: explainMix(kind, ctx, detail), songs: songs.slice(0, size) };
}

/**
 * The weekly discovery picks ("New to you this week", and Your Week at
 * /weekly). Only songs the listener has never played: not in the listening
 * history or taste profile, and not in the lifetime heard-set once it is
 * loaded (`heard`, ./heardSet.ts). First the songs whose lead artist they
 * have never played either, then topped up from the explore source, whose
 * picks may be by any artist. At most three songs per lead artist. Pure: the
 * week's salt and cache live with the caller (features/weekly/useWeeklyMix).
 */
export function weekDiscoveries(
  ranked: ScoredCandidate[],
  ctx: Pick<RecommendationContext, 'profile' | 'history'>,
  n = WEEK_SIZE,
  heard: ((key: string) => boolean) | undefined = heardCheck(),
): Song[] {
  const { knownArtists, playedSongIds } = listenerFamiliarity(ctx);
  const leadOf = (s: Song): string => (s.artists?.[0]?.name ?? '').trim().toLowerCase();
  const out: Song[] = [];
  const taken = new Set<string>();
  const perArtist = new Map<string, number>();
  const pass = (pred: (s: ScoredCandidate) => boolean): void => {
    for (const s of ranked) {
      if (out.length >= n) return;
      const song = s.candidate.song;
      if (taken.has(song.id) || playedSongIds.has(song.id) || heard?.(songKey(song)) || !pred(s)) continue;
      const lead = leadOf(song);
      if (lead && (perArtist.get(lead) ?? 0) >= 3) continue;
      perArtist.set(lead, (perArtist.get(lead) ?? 0) + 1);
      taken.add(song.id);
      out.push(song);
    }
  };
  pass((s) => !knownArtists.has(leadOf(s.candidate.song)));
  pass((s) => s.candidate.source === 'explore');
  return out;
}

/**
 * Package A4 — swap a shelf's tail (~15%) for exploration picks. Taste order
 * stays up front; discovery lives at the end of the row where it invites a
 * scroll instead of hijacking the lead. Pure — the caller marks `injected`
 * as used. No-op when the pool is empty or the shelf is too small for a slot.
 */
export function injectExplore(
  picked: ScoredCandidate[],
  pool: ScoredCandidate[],
  ratio = 0.15,
): { out: ScoredCandidate[]; injected: ScoredCandidate[] } {
  const slots = Math.min(Math.floor(picked.length * ratio), pool.length);
  if (slots <= 0) return { out: picked, injected: [] };
  const injected = pool.slice(0, slots);
  return { out: [...picked.slice(0, picked.length - slots), ...injected], injected };
}

/** Assemble explainable shelves from the ranked candidate pool. */
export function buildMixes(rankedInput: ScoredCandidate[], ctx: RecommendationContext): Mix[] {
  // v7.0.0 — one entry per canonical song (the original cut wins) before any
  // shelf is drawn, so versions of one song cannot share or repeat across shelves.
  const ranked = dedupeByIdentity(rankedInput, (s) => s.candidate.song);
  const out: Mix[] = [];
  const used = new Set<string>();

  const take = (pred: (s: ScoredCandidate) => boolean, n = MIX_SIZE, allowReuse = false) => {
    const picked: ScoredCandidate[] = [];
    const perArtist = new Map<string, number>();
    for (const s of ranked) {
      if (picked.length >= n) break;
      if (!allowReuse && used.has(s.candidate.song.id)) continue;
      if (!pred(s)) continue;
      // Diversity guard: a single artist never dominates a shelf.
      const artistKey = s.candidate.song.artists[0]?.name.toLowerCase() ?? '';
      if (artistKey && (perArtist.get(artistKey) ?? 0) >= 3) continue;
      perArtist.set(artistKey, (perArtist.get(artistKey) ?? 0) + 1);
      picked.push(s);
    }
    picked.forEach((s) => used.add(s.candidate.song.id));
    return picked;
  };

  // A4 — the exploration pool (empty unless explore mode is on). Injected into
  // the taste-generic shelves only; language-titled shelves keep their promise.
  const explorePool = ctx.explore ? ranked.filter((s) => s.candidate.source === 'explore') : [];
  const unusedExplore = () => explorePool.filter((s) => !used.has(s.candidate.song.id));
  const withExplore = (picked: ScoredCandidate[]): ScoredCandidate[] => {
    const { out: shelf, injected } = injectExplore(picked, unusedExplore());
    injected.forEach((s) => used.add(s.candidate.song.id));
    return shelf;
  };

  // Made For You — the flagship shelf.
  const mfy = withExplore(take(() => true));
  const m1 = mix('made-for-you', 'made-for-you', 'Made For You', songsOf(mfy), ctx);
  if (m1) out.push(m1);

  // Daily Mixes — one per top language cluster.
  const langs = topLanguages(ctx.profile, 3).map((l) => l.id);
  const dailyLangs = langs.length ? langs : ctx.pinnedLanguages.slice(0, 2);
  dailyLangs.forEach((lang, i) => {
    const picks = take((s) => s.candidate.song.language === lang);
    const m = mix(`daily-${lang}`, 'daily', `Daily Mix ${i + 1} · ${languageLabel(lang)}`, songsOf(picks), ctx, lang);
    if (m) out.push(m);
  });

  // Because You Played — grouped by related-seed.
  const seeds = new Map<string, ScoredCandidate[]>();
  for (const s of ranked) {
    if (s.candidate.source === 'related' && s.candidate.seedTitle) {
      const arr = seeds.get(s.candidate.seedTitle) ?? [];
      arr.push(s);
      seeds.set(s.candidate.seedTitle, arr);
    }
  }
  let becauseCount = 0;
  for (const [seed, list] of seeds) {
    if (becauseCount >= 2) break;
    const unused = list.filter((s) => !used.has(s.candidate.song.id));
    const m = mix(`because-${seed}`, 'because', `Because you played “${seed}”`, songsOf(unused), ctx, seed);
    if (m) {
      unused.forEach((s) => used.add(s.candidate.song.id));
      out.push(m);
      becauseCount += 1;
    }
  }

  // Time-of-day shelf.
  const tod = timeOfDaySeed(ctx.hour, dailyLangs[0] ?? 'hindi');
  const timePicks = withExplore(take(() => true, 15));
  const mTime = mix(`time-${ctx.hour}`, 'time', tod.title, songsOf(timePicks, 15), ctx);
  if (mTime) out.push(mTime);

  // Rediscover.
  const redis = take((s) => s.candidate.source === 'rediscovery', 15, true);
  const mRedis = mix('rediscover', 'rediscover', 'Rediscover Your Favorites', songsOf(redis, 15), ctx);
  if (mRedis) out.push(mRedis);

  // Low-skip shelf.
  const lowSkip = take((s) => s.reasons.some((r) => r.kind === 'low-skip'), 15);
  const mLow = mix('low-skip', 'low-skip', 'Songs You Never Skip', songsOf(lowSkip, 15), ctx);
  if (mLow) out.push(mLow);

  // Fresh picks: recent releases, novelty-weighted.
  const year = new Date().getFullYear();
  const fresh = take((s) => {
    const y = s.candidate.song.year ? Number(s.candidate.song.year) : 0;
    return y >= year - 1;
  }, 15);
  const mFresh = mix('fresh', 'fresh', 'Fresh Picks', songsOf(fresh, 15), ctx);
  if (mFresh) out.push(mFresh);

  // A4 — the dedicated discovery shelf (explore mode only): whatever the
  // exploration pool still holds after the per-shelf injections.
  if (ctx.explore) {
    const exp = take((s) => s.candidate.source === 'explore', 12);
    const mExp = mix('explore', 'explore', 'Something Different', songsOf(exp, 12), ctx);
    if (mExp) out.push(mExp);
  }

  // ------------------------------------------------------------------------
  // 4.13.0 — Deeper personal mixes. Each is a real context read: the shelf
  // only appears when the moment justifies it. No fake "always on" bands.
  // ------------------------------------------------------------------------

  // Weekend Slowburn — only appears Sat/Sun. Slower/longer picks first.
  const dow = new Date().getDay();
  if (dow === 0 || dow === 6) {
    const weekend = take((s) => {
      const dur = s.candidate.song.duration ?? 0;
      return dur === 0 || dur >= 210; // 3:30+
    }, 15, true);
    const mWk = mix('weekend', 'weekend', dow === 0 ? 'Sunday Slowburn' : 'Saturday Long-Play', songsOf(weekend, 15), ctx);
    if (mWk) out.push(mWk);
  }

  // Late Night — 22:00-04:00. Prefers low-skip, artists you actually finish.
  if (ctx.hour >= 22 || ctx.hour < 4) {
    const night = take((s) => s.reasons.some((r) => r.kind === 'low-skip' || r.kind === 'artist'), 15, true);
    const mNight = mix('late-night', 'late-night', 'Late Night, Yours', songsOf(night, 15), ctx);
    if (mNight) out.push(mNight);
  }

  // Comeback Mix — inactive for a while. Uses recentSongIds recall in scoring.
  const lastPlay = ctx.history[0]?.ts ?? 0;
  const gapDays = lastPlay ? (Date.now() - lastPlay) / 86_400_000 : Infinity;
  if (gapDays > 3 && ctx.history.length > 0) {
    const back = take(() => true, 15, true);
    const mBack = mix('comeback', 'comeback', 'Welcome Back — pick up here', songsOf(back, 15), ctx);
    if (mBack) out.push(mBack);
  }

  // Artist Radio — one station around the listener's #1 artist. Uses
  // co-play affinity via the artist reason already surfaced by scoring.
  const topArtist = topArtists(ctx.profile, 1)[0];
  if (topArtist && topArtist.affinity.plays >= 5) {
    const artName = topArtist.affinity.name;
    const radio = take((s) => {
      const names = s.candidate.song.artists.map((a) => a.name.toLowerCase());
      return names.includes(artName.toLowerCase()) || s.reasons.some((r) => r.kind === 'co-play');
    }, 15, true);
    const mRadio = mix(`artist-radio-${topArtist.key}`, 'artist-radio', `${artName} Radio`, songsOf(radio, 15), ctx, artName);
    if (mRadio) out.push(mRadio);
  }

  // The weekly discovery lane — refreshes every Monday (via mondayStamp): songs
  // never heard by artists never played (./weekDiscoveries). Your Week at
  // /weekly is this same mix, built with the week's salt and kept until Monday.
  // 9.0.0 — its own name (the old title echoed another product's feature name).
  const mDW = mix(`discover-weekly-${mondayStamp()}`, 'discover-weekly', 'New to you this week', weekDiscoveries(ranked, ctx), ctx, undefined, WEEK_SIZE);
  if (mDW) out.push(mDW);

  return out;
}

/** ISO week-anchor stamp: same value all week, changes at Monday 00:00 local.
 *  Baked into the discover-weekly mix id so the shelf visibly "refreshes"
 *  every Monday without needing a cache-buster elsewhere. */
function mondayStamp(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
