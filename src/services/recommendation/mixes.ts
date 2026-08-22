import type { Song } from '@/types';
import { timeOfDaySeed } from '@/constants/seeds';
import { languageLabel } from '@/constants/languages';
import { topLanguages } from '@/services/personalization/profile';
import { explainMix } from './explanations';
import type { Mix, RecommendationContext, ScoredCandidate } from './types';

const MIX_SIZE = 20;
const MIN_MIX_SIZE = 4;

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
): Mix | null {
  if (songs.length < MIN_MIX_SIZE) return null;
  return { id, kind, title, explanation: explainMix(kind, ctx, detail), songs: songs.slice(0, MIX_SIZE) };
}

/** Assemble explainable shelves from the ranked candidate pool. */
export function buildMixes(ranked: ScoredCandidate[], ctx: RecommendationContext): Mix[] {
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

  // Made For You — the flagship shelf.
  const mfy = take(() => true);
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
  const timePicks = take(() => true, 15);
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

  return out;
}
