import {
  artistLastSeen,
  artistSkipScore,
  artistWeight,
  languageWeight,
  lowSkipScore,
  profileConfidence,
  timeOfDayWeight,
} from '@/services/personalization/profile';
import type { Candidate, ReasonComponent, RecommendationContext, ScoredCandidate } from './types';
import { inferMood, moodMatchScore } from './mood';

const SOURCE_BOOST: Record<Candidate['source'], number> = {
  related: 0.18,
  'favorite-artist': 0.14,
  'favorite-album': 0.12,
  rediscovery: 0.1,
  trending: 0.06,
  history: 0.0,
};

/**
 * Deterministic hybrid scoring. Personalized terms are blended in by
 * `confidence * intensity`, so a cold profile leans on popularity/trending
 * and a warm profile leans on taste — explainable via the reasons array.
 */
export function scoreCandidate(c: Candidate, ctx: RecommendationContext): ScoredCandidate {
  const { profile } = ctx;
  const reasons: ReasonComponent[] = [];
  const song = c.song;

  if (song.language && ctx.mutedLanguages.includes(song.language)) {
    return { candidate: c, score: -1, reasons: [] };
  }

  const confidence = profileConfidence(profile);
  const personalBlend = (0.3 + 0.7 * confidence) * (0.4 + 0.6 * ctx.intensity);

  let score = 0;

  const langW = languageWeight(profile, song.language);
  const pinned = song.language != null && ctx.pinnedLanguages.includes(song.language);
  const langTerm = (langW * 0.3 + (pinned ? 0.12 : 0)) * personalBlend;
  if (langTerm > 0.02) reasons.push({ kind: 'language', weight: langTerm, detail: song.language ?? undefined });
  score += langTerm;

  const artW =
    artistWeight(
      profile,
      song.artists.map((a) => a.id).filter(Boolean),
      song.artists.map((a) => a.name),
    ) * 0.3 * personalBlend;
  if (artW > 0.02) reasons.push({ kind: 'artist', weight: artW, detail: song.artists[0]?.name });
  score += artW;

  // Recency boost: artists you've played in the last week stay "hot".
  const lastSeen = artistLastSeen(
    profile,
    song.artists.map((a) => a.id).filter(Boolean),
    song.artists.map((a) => a.name),
  );
  if (lastSeen && Date.now() - lastSeen < 7 * 86_400_000) {
    score += 0.05 * personalBlend;
  }

  const pop = song.playCount ? Math.min(Math.log10(song.playCount + 1) / 8, 1) * 0.15 : 0.04;
  reasons.push({ kind: 'popularity', weight: pop });
  score += pop;

  // Time-of-day affinity: boost languages you tend to play around this hour.
  const todW = timeOfDayWeight(profile, song.language, ctx.hour) * 0.08 * personalBlend;
  if (todW > 0.02) reasons.push({ kind: 'time', weight: todW });
  score += todW;

  // Mood continuity: nudge toward candidates whose inferred mood matches the
  // session's mood (session-based, so it applies even for a cold profile).
  if (ctx.sessionMood) {
    const mm = (moodMatchScore(inferMood(song), ctx.sessionMood) - 0.4) * 0.12;
    if (Math.abs(mm) > 0.02) reasons.push({ kind: 'mood', weight: mm, detail: ctx.sessionMood });
    score += mm;
  }

  // Skip aversion (signed around 0.5): reward what you finish, demote what you skip.
  if (song.language && profile.languages[song.language]) {
    const ls = (lowSkipScore(profile.languages[song.language]) - 0.5) * 0.2 * personalBlend;
    if (Math.abs(ls) > 0.02) reasons.push({ kind: 'low-skip', weight: ls });
    score += ls;
  }
  const artSkip =
    (artistSkipScore(
      profile,
      song.artists.map((a) => a.id).filter(Boolean),
      song.artists.map((a) => a.name),
    ) - 0.5) * 0.14 * personalBlend;
  score += artSkip;

  const boost = SOURCE_BOOST[c.source];
  score += boost;
  if (c.source === 'related') reasons.push({ kind: 'related', weight: boost, detail: c.seedTitle });
  if (c.source === 'rediscovery') reasons.push({ kind: 'rediscovery', weight: boost });
  if (c.source === 'trending') reasons.push({ kind: 'trending', weight: boost });

  // Freshness: light boost for recent releases (novelty without dominating).
  const year = song.year ? Number(song.year) : null;
  if (year && year >= new Date().getFullYear() - 1) score += 0.04;

  // Repetition guard: heavily demote very recently played songs.
  if (profile.recentSongIds.includes(song.id)) score -= 0.5;

  return { candidate: c, score, reasons: reasons.sort((a, b) => b.weight - a.weight) };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffle candidates WITHIN equal-ish score tiers (~0.05 bands) so which
 *  strong picks surface and their order vary per session salt — fresh without
 *  sacrificing relevance. */
function shuffleTiers(list: ScoredCandidate[], salt: number): ScoredCandidate[] {
  const rng = mulberry32((salt | 0) || 1);
  const out: ScoredCandidate[] = [];
  let i = 0;
  while (i < list.length) {
    const band = Math.round(list[i].score * 20);
    let j = i + 1;
    while (j < list.length && Math.round(list[j].score * 20) === band) j += 1;
    const group = list.slice(i, j);
    for (let k = group.length - 1; k > 0; k -= 1) {
      const r = Math.floor(rng() * (k + 1));
      [group[k], group[r]] = [group[r], group[k]];
    }
    out.push(...group);
    i = j;
  }
  return out;
}

export function rankCandidates(candidates: Candidate[], ctx: RecommendationContext): ScoredCandidate[] {
  const seen = new Set<string>();
  const out: ScoredCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.song.id)) continue;
    seen.add(c.song.id);
    const scored = scoreCandidate(c, ctx);
    if (scored.score > 0) out.push(scored);
  }
  out.sort((a, b) => b.score - a.score);
  return shuffleTiers(out, ctx.salt);
}
