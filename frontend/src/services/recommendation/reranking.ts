import type { RecommendationContext, ScoredCandidate } from './types';
import { buildSongProfile, overlap } from './profiles';
import { RECOMMENDATION_WEIGHTS } from './weights';

/** Greedy MMR-style re-ranker. Relevance remains primary, but repeated
 * artists/languages/genres are penalised and an explore source gets a small
 * discovery floor so a long queue does not collapse into one artist. */
export function rerankCandidates(items: ScoredCandidate[], ctx: RecommendationContext, limit = items.length): ScoredCandidate[] {
  const remaining = [...items];
  const chosen: ScoredCandidate[] = [];
  const profiles = new Map(items.map(item => [item.candidate.song.id, buildSongProfile(item.candidate.song)]));
  while (remaining.length && chosen.length < limit) {
    let bestIndex = 0;
    let bestUtility = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const item = remaining[i];
      const profile = profiles.get(item.candidate.song.id)!;
      const repeated = chosen.slice(-4).reduce((sum, pick) => {
        const other = profiles.get(pick.candidate.song.id)!;
        return sum + Math.max(overlap(profile.artistIds, other.artistIds), overlap(profile.artistNames, other.artistNames)) * 0.7 + overlap(profile.genres, other.genres) * 0.2 + (profile.language && profile.language === other.language ? 0.1 : 0);
      }, 0);
      const novelty = (item.candidate.source === 'explore' ? RECOMMENDATION_WEIGHTS.discovery * 0.2 : 0) + (ctx.explore && chosen.length % 6 === 5 ? 0.01 : 0);
      const utility = item.score - repeated * RECOMMENDATION_WEIGHTS.diversity + novelty;
      if (utility > bestUtility) { bestUtility = utility; bestIndex = i; }
    }
    const [pick] = remaining.splice(bestIndex, 1);
    chosen.push(pick);
  }
  return chosen;
}
