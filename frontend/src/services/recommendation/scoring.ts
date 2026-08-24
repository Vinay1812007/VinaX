import {
  artistLastSeen,
  artistSkipScore,
  artistWeight,
  languageWeight,
  lowSkipScore,
  profileConfidence,
  timeOfDayWeight,
} from '@/services/personalization/profile';
import { energyOfSong } from '@/services/personalization/session';
import { coPlayAffinity, coPlayIndexFor } from './coplay';
import type { Candidate, ReasonComponent, RecommendationContext, ScoredCandidate } from './types';
import { inferMood, moodMatchScore } from './mood';

const SOURCE_BOOST: Record<Candidate['source'], number> = {
  related: 0.18,
  'favorite-artist': 0.14,
  'favorite-album': 0.12,
  rediscovery: 0.1,
  // A4 — explore candidates have zero taste affinity by construction, so the
  // boost keeps them positive (rankCandidates drops score <= 0) while still
  // ranking below real taste matches; the mixer guarantees their shelf slots.
  explore: 0.08,
  trending: 0.06,
  history: 0.0,
};

// Package C3 — the only reliable "instrumental" signal from catalog metadata is
// the title itself, so the vocal↔instrumental dial nudges just these obvious
// cuts and leaves everything else untouched (honest over a fake heuristic).
const INSTRUMENTAL_RE = /\b(instrumental|bgm|background score|theme music|karaoke|lo-?fi)\b/i;

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

  const artistIds = song.artists.map((a) => a.id).filter(Boolean);
  const artistNames = song.artists.map((a) => a.name);
  const rawArtW = artistWeight(profile, artistIds, artistNames);
  const artW = rawArtW * 0.3 * personalBlend;
  if (artW > 0.02) reasons.push({ kind: 'artist', weight: artW, detail: song.artists[0]?.name });
  score += artW;

  // Roadmap O.3 — co-play similarity: candidates by artists this listener
  // plays in the same sitting as the SEED's artists (radio/auto-queue set
  // ctx.coPlaySeed). Entirely on-device; index memoized per history state.
  if (ctx.coPlaySeed && ctx.history.length >= 8) {
    const affinity = coPlayAffinity(coPlayIndexFor(ctx.history), ctx.coPlaySeed, song);
    if (affinity > 0) {
      const coTerm = affinity * 0.14 * personalBlend;
      if (coTerm > 0.02) reasons.push({ kind: 'co-play', weight: coTerm, detail: song.artists[0]?.name });
      score += coTerm;
    }
  }

  // Recency boost: artists you've played in the last week stay "hot".
  const lastSeen = artistLastSeen(profile, artistIds, artistNames);
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

  // Package A1 — session vector (energy + language momentum). Blended at a
  // gentle ~0.10 so the current-mood arc colours the ordering without
  // overriding long-term taste. The vector strengthens as more songs play
  // this session (sessionSize), fading in from a single-track fluke.
  if (typeof ctx.sessionEnergy === 'number') {
    const ramp = Math.min(1, (ctx.sessionSize ?? 0) / 5); // full weight after ~5 plays
    const candEnergy = energyOfSong(song);
    // Closeness on the energy axis, signed around the midpoint: identical
    // energy → +, opposite → −. Max ±0.07 at full ramp.
    const energyNudge = (0.5 - Math.abs(candEnergy - ctx.sessionEnergy)) * 0.14 * ramp;
    // Language momentum: you're on a run in one language right now. Small,
    // additive, distinct from the long-term pinned-language preference.
    const langMomentum = ctx.sessionLanguage && song.language === ctx.sessionLanguage ? 0.03 * ramp : 0;
    const sessionTerm = energyNudge + langMomentum;
    if (Math.abs(sessionTerm) > 0.02) reasons.push({ kind: 'session', weight: sessionTerm });
    score += sessionTerm;
  }

  // Skip aversion (signed around 0.5): reward what you finish, demote what you skip.
  if (song.language && profile.languages[song.language]) {
    const ls = (lowSkipScore(profile.languages[song.language]) - 0.5) * 0.2 * personalBlend;
    if (Math.abs(ls) > 0.02) reasons.push({ kind: 'low-skip', weight: ls });
    score += ls;
  }
  const artSkip = (artistSkipScore(profile, artistIds, artistNames) - 0.5) * 0.14 * personalBlend;
  score += artSkip;

  const boost = SOURCE_BOOST[c.source];
  score += boost;
  if (c.source === 'related') reasons.push({ kind: 'related', weight: boost, detail: c.seedTitle });
  if (c.source === 'rediscovery') reasons.push({ kind: 'rediscovery', weight: boost });
  if (c.source === 'trending') reasons.push({ kind: 'trending', weight: boost });
  if (c.source === 'explore') reasons.push({ kind: 'discovery', weight: boost, detail: song.language ?? undefined });

  // Freshness: light boost for recent releases (novelty without dominating).
  const year = song.year ? Number(song.year) : null;
  if (year && year >= new Date().getFullYear() - 1) score += 0.04;

  // Package A10 — festival/season boost: during a festival window, lift songs in
  // its languages or mood a touch. Silent (like freshness) — it colours ranking
  // without a reason chip. Off-season the field is absent and this is skipped.
  if (ctx.festival) {
    if (ctx.festival.languages && song.language && ctx.festival.languages.includes(song.language)) score += 0.14;
    if (ctx.festival.moods && ctx.festival.moods.includes(inferMood(song))) score += 0.1;
  }

  // Repetition guard: heavily demote very recently played songs.
  if (profile.recentSongIds.includes(song.id)) score -= 0.5;

  // Package C3 — hand-tuned taste dials. Small signed linear nudges that vanish
  // at the neutral 0.5 default (an untouched profile scores exactly as before)
  // and are gated behind the optional field, so cold profiles pay nothing.
  const dials = profile.sliders;
  if (dials) {
    // Familiar ↔ adventurous: adventurous lifts discovery sources and demotes
    // the over-familiar; familiar does the reverse. Symmetric around neutral.
    const adv = (dials.adventurous - 0.5) * 2;
    const discovery = c.source === 'rediscovery' || c.source === 'trending' || c.source === 'related';
    score += adv * ((discovery ? 0.05 : 0) - rawArtW * 0.06);
    // Classics ↔ recent: map release age to a signed recency axis (+new, −old).
    if (year) {
      const age = new Date().getFullYear() - year;
      const yr = age <= 1 ? 1 : age >= 9 ? -1 : (5 - age) / 4;
      score += (dials.recency - 0.5) * 2 * yr * 0.06;
    }
    // Melody ↔ beats: reward candidates near the preferred end of the energy axis.
    score += (dials.energy - 0.5) * 2 * (energyOfSong(song) - 0.5) * 0.1;
    // Vocal ↔ instrumental: title-detectable instrumentals only.
    if (INSTRUMENTAL_RE.test(song.title)) score += -((dials.vocalness - 0.5) * 2) * 0.06;
  }

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
