import {
  artistLastSeen,
  artistSkipScore,
  artistWeight,
  dayOfWeekWeight,
  languageWeight,
  lowSkipScore,
  preferredEnergy,
  profileConfidence,
  songWeight,
  timeOfDayWeight,
} from '@/services/personalization/profile';
import { energyOfSong } from '@/services/personalization/session';
import { coPlayAffinity, coPlayIndexFor } from './coplay';
import type { Candidate, ReasonComponent, RecommendationContext, ScoredCandidate } from './types';
import { inferMood, moodMatchScore } from './mood';
import { buildSongProfile, overlap, type SongProfile } from './profiles';
import { RECOMMENDATION_WEIGHTS } from './weights';
import { rerankCandidates } from './reranking';

const SOURCE_BOOST: Record<Candidate['source'], number> = {
  related: 0.18,
  'favorite-artist': 0.14,
  'favorite-album': 0.12,
  rediscovery: 0.1,
  // A4 — explore candidates have zero taste affinity by construction, so the
  // boost keeps them positive (rankCandidates drops score <= 0) while still
  // ranking below real taste matches; the mixer guarantees their shelf slots.
  explore: 0.08,
  // v7.1.0 — gathered for what the listener just asked for: outranks passive sources.
  intent: 0.24,
  trending: 0.06,
  // v7.0.0 — Familiar mode's own favourites and finished songs.
  history: 0.1,
};

// Package C3 — the only reliable "instrumental" signal from catalog metadata is
// the title itself, so the vocal↔instrumental dial nudges just these obvious
// cuts and leaves everything else untouched (honest over a fake heuristic).
const INSTRUMENTAL_RE = /\b(instrumental|bgm|background score|theme music|karaoke|lo-?fi)\b/i;

/**
 * v7.0.0 — everything about a ranking pass that does not depend on the
 * candidate, computed once instead of once per song: the seed's profile,
 * the affinity maxima, the listener's played songs and artists, how often
 * each lead artist appeared in the last few plays, and the effective
 * discovery lean (mode + this sitting's appetite).
 */
export interface ScoringFrame {
  personalBlend: number;
  seedProfile: SongProfile | null;
  maxGenre: number;
  maxVibe: number;
  playedSongIds: Set<string>;
  knownArtists: Set<string>;
  recentArtistCounts: Map<string, number>;
  /** −1 (familiar) … +1 (discover), after the session's appetite is folded in. */
  lean: number;
  /** 0..1 — how much weight the session intent gets (fades in over its first events). */
  intentRamp: number;
  year: number;
}

const MODE_LEAN = { familiar: -1, balanced: 0, discover: 1 } as const;
const lower = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

export function effectiveDiscoveryMode(ctx: RecommendationContext): 'familiar' | 'balanced' | 'discover' {
  return ctx.discoveryMode ?? (ctx.explore ? 'discover' : 'balanced');
}

export function buildScoringFrame(ctx: RecommendationContext): ScoringFrame {
  const { profile } = ctx;
  const confidence = profileConfidence(profile);
  const user = ctx.userProfile;
  const knownArtists = new Set<string>();
  for (const a of Object.values(profile.artists)) if (a.plays > 0 || a.completes > 0) knownArtists.add(lower(a.name));
  const playedSongIds = new Set<string>(profile.recentSongIds);
  for (const id of Object.keys(profile.songs ?? {})) playedSongIds.add(id);
  const recentArtistCounts = new Map<string, number>();
  ctx.history.forEach((entry, i) => {
    playedSongIds.add(entry.song.id);
    const lead = lower(entry.song.artists[0]?.name);
    if (!lead) return;
    knownArtists.add(lead);
    if (i < 10) recentArtistCounts.set(lead, (recentArtistCounts.get(lead) ?? 0) + 1);
  });
  const intent = ctx.sessionIntent;
  const lean = Math.max(-1, Math.min(1, MODE_LEAN[effectiveDiscoveryMode(ctx)] + (intent ? intent.discoveryAppetite * 0.6 : 0)));
  return {
    personalBlend: (0.3 + 0.7 * confidence) * (0.4 + 0.6 * ctx.intensity),
    seedProfile: ctx.seedSong ? buildSongProfile(ctx.seedSong) : null,
    maxGenre: user ? Math.max(1, ...Object.values(user.genres)) : 1,
    maxVibe: user ? Math.max(1, ...Object.values(user.vibes)) : 1,
    playedSongIds,
    knownArtists,
    recentArtistCounts,
    lean,
    intentRamp: intent ? Math.min(1, intent.size / 3) : 0,
    year: new Date().getFullYear(),
  };
}

/**
 * Deterministic hybrid scoring. Personalized terms are blended in by
 * `confidence * intensity`, so a cold profile leans on popularity/trending
 * and a warm profile leans on taste — explainable via the reasons array.
 * Pass a `frame` when scoring many candidates against one context.
 */
export function scoreCandidate(c: Candidate, ctx: RecommendationContext, frame: ScoringFrame = buildScoringFrame(ctx)): ScoredCandidate {
  const { profile } = ctx;
  const reasons: ReasonComponent[] = [];
  const song = c.song;

  if (song.language && ctx.mutedLanguages.includes(song.language)) {
    return { candidate: c, score: -1, reasons: [] };
  }

  const personalBlend = frame.personalBlend;

  let score = 0;
  const candidateProfile = buildSongProfile(song);
  const seedProfile = frame.seedProfile;
  const user = ctx.userProfile;

  // Content similarity against the current seed/session. These terms are
  // intentionally independent, so a dialect or genre can be tuned without
  // changing the rest of the model.
  if (seedProfile) {
    const mood = moodMatchScore(candidateProfile.mood, seedProfile.mood);
    const moodTerm = mood * RECOMMENDATION_WEIGHTS.mood;
    score += moodTerm;
    if (moodTerm > 0.02) reasons.push({ kind: 'mood', weight: moodTerm, detail: seedProfile.mood });
    const vibeTerm = overlap(candidateProfile.vibes, seedProfile.vibes) * RECOMMENDATION_WEIGHTS.vibe;
    const genreTerm = overlap(candidateProfile.genres, seedProfile.genres) * RECOMMENDATION_WEIGHTS.genre;
    if (vibeTerm > 0.02) reasons.push({ kind: 'vibe', weight: vibeTerm });
    if (genreTerm > 0.02) reasons.push({ kind: 'genre', weight: genreTerm });
    score += vibeTerm + genreTerm;
    if (candidateProfile.language && candidateProfile.language === seedProfile.language) score += RECOMMENDATION_WEIGHTS.language;
    if (candidateProfile.dialect && candidateProfile.dialect === seedProfile.dialect) {
      score += RECOMMENDATION_WEIGHTS.dialect;
      reasons.push({ kind: 'dialect', weight: RECOMMENDATION_WEIGHTS.dialect, detail: candidateProfile.dialect });
    }
    if (candidateProfile.subLanguage && candidateProfile.subLanguage === seedProfile.subLanguage) score += RECOMMENDATION_WEIGHTS.dialect * 0.65;
    const energyTerm = (1 - Math.abs(candidateProfile.energy - seedProfile.energy)) * RECOMMENDATION_WEIGHTS.energy;
    const tempoTerm = (1 - Math.min(1, Math.abs(candidateProfile.tempo - seedProfile.tempo) / 80)) * RECOMMENDATION_WEIGHTS.tempo;
    score += energyTerm + tempoTerm;
    if (energyTerm > 0.02) reasons.push({ kind: 'energy', weight: energyTerm });
    if (tempoTerm > 0.02) reasons.push({ kind: 'tempo', weight: tempoTerm });
  }

  if (user) {
    const genreAffinity = candidateProfile.genres.reduce((m, g) => Math.max(m, user.genres[g] ?? 0), 0);
    const vibeAffinity = candidateProfile.vibes.reduce((m, v) => Math.max(m, user.vibes[v] ?? 0), 0);
    const { maxGenre, maxVibe } = frame;
    score += (genreAffinity / maxGenre) * RECOMMENDATION_WEIGHTS.genre * 0.6;
    score += (vibeAffinity / maxVibe) * RECOMMENDATION_WEIGHTS.vibe * 0.6;
    if (candidateProfile.dialect && user.dialects[candidateProfile.dialect]) score += RECOMMENDATION_WEIGHTS.dialect * 0.4;
    if (candidateProfile.subLanguage && user.subLanguages[candidateProfile.subLanguage]) score += RECOMMENDATION_WEIGHTS.dialect * 0.25;
    if (user.avgEnergy != null) score += (1 - Math.abs(candidateProfile.energy - user.avgEnergy)) * RECOMMENDATION_WEIGHTS.energy * 0.35;
    if (user.avgTempo != null) score += (1 - Math.min(1, Math.abs(candidateProfile.tempo - user.avgTempo) / 80)) * RECOMMENDATION_WEIGHTS.tempo * 0.35;
    if (user.likedSongIds.has(song.id)) {
      score += RECOMMENDATION_WEIGHTS.likes;
      reasons.push({ kind: 'likes', weight: RECOMMENDATION_WEIGHTS.likes });
    }
    if (user.skippedSongIds.has(song.id)) {
      score -= RECOMMENDATION_WEIGHTS.skips;
      reasons.push({ kind: 'low-skip', weight: -RECOMMENDATION_WEIGHTS.skips });
    }
    if (user.recentSongIds.has(song.id)) {
      score -= RECOMMENDATION_WEIGHTS.history;
      reasons.push({ kind: 'history', weight: -RECOMMENDATION_WEIGHTS.history });
    }
  }

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
  // plays in the same sitting as the seed's artists (catalog recommendation set
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

  const pop = song.playCount ? Math.min(Math.log10(song.playCount + 1) / 8, 1) * RECOMMENDATION_WEIGHTS.popularity * 3 : 0.04;
  reasons.push({ kind: 'popularity', weight: pop });
  score += pop;

  // Time-of-day affinity: boost languages you tend to play around this hour.
  const todW = timeOfDayWeight(profile, song.language, ctx.hour) * 0.08 * personalBlend;
  if (todW > 0.02) reasons.push({ kind: 'time', weight: todW });
  score += todW;

  // v6.4.0 — song affinity: a song you keep finishing earns its own term,
  // distinct from its artist (a favourite album track vs. the artist's catalogue).
  const sw = songWeight(profile, song.id) * RECOMMENDATION_WEIGHTS.songAffinity * personalBlend;
  if (sw > 0.02) reasons.push({ kind: 'song', weight: sw });
  score += sw;

  // v6.4.0 — day-of-week rhythm: a small lift on the days this listener plays most
  // (weekend-heavy listeners get their weekend sound on weekends).
  const dw = dayOfWeekWeight(profile, ctx.dayOfWeek ?? new Date().getDay()) * RECOMMENDATION_WEIGHTS.dayOfWeek * personalBlend;
  if (dw > 0.02) reasons.push({ kind: 'day', weight: dw });
  score += dw;

  // v6.4.0 — persisted energy preference (from completed plays) when the
  // session-derived average is not available yet.
  if (user && user.avgEnergy == null) {
    const pref = preferredEnergy(profile);
    if (pref != null) {
      const et = (1 - Math.abs(candidateProfile.energy - pref)) * RECOMMENDATION_WEIGHTS.energy * 0.3 * personalBlend;
      if (et > 0.02) reasons.push({ kind: 'energy', weight: et, detail: 'your usual energy' });
      score += et;
    }
  }

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
  if (c.source === 'intent') reasons.push({ kind: 'intent', weight: boost });

  // Freshness: light boost for recent releases (novelty without dominating).
  const year = song.year ? Number(song.year) : null;
  if (year && year >= frame.year - 1) score += RECOMMENDATION_WEIGHTS.freshness;

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
    const discovery = c.source === 'explore' || c.source === 'rediscovery' || c.source === 'trending' || c.source === 'related';
    score += adv * ((discovery ? 0.05 : 0) - rawArtW * 0.06);
    // Classics ↔ recent: map release age to a signed recency axis (+new, −old).
    if (year) {
      const age = frame.year - year;
      const yr = age <= 1 ? 1 : age >= 9 ? -1 : (5 - age) / 4;
      score += (dials.recency - 0.5) * 2 * yr * 0.06;
    }
    // Melody ↔ beats: reward candidates near the preferred end of the energy axis.
    score += (dials.energy - 0.5) * 2 * (energyOfSong(song) - 0.5) * 0.1;
    // Vocal ↔ instrumental: title-detectable instrumentals only.
    if (INSTRUMENTAL_RE.test(song.title)) score += -((dials.vocalness - 0.5) * 2) * 0.06;
  }

  // v7.0.0 — Familiar / Balanced / Discover. One signed swing between novelty
  // and familiarity: 0 = a song already played, 0.5 = a known artist's unheard
  // song, 1 = an artist never played. `lean` is the mode plus what this
  // sitting's behaviour asks for (a skip streak leans familiar, a long run of
  // completions earns room to roam), so Balanced stays exactly neutral until
  // the listener's own actions tip it.
  const lead = lower(song.artists[0]?.name);
  if (frame.lean !== 0) {
    const novelty = frame.playedSongIds.has(song.id) ? 0 : lead && frame.knownArtists.has(lead) ? 0.5 : 1;
    const swing = frame.lean * (novelty - 0.5) * RECOMMENDATION_WEIGHTS.novelty;
    if (swing > 0.02) reasons.push(frame.lean > 0 ? { kind: 'discovery', weight: swing, detail: novelty === 1 ? 'new-artist' : 'new-song' } : { kind: 'familiar', weight: swing });
    score += swing;
  }

  // v7.0.0 — artist fatigue: the third, fourth… song by one lead artist inside
  // the last ten plays costs a little more each time. Long-term affinity is
  // untouched; this only spaces an artist out while they are over-present.
  const recentByArtist = lead ? frame.recentArtistCounts.get(lead) ?? 0 : 0;
  if (recentByArtist > 2) {
    const fatigue = -Math.min(4, recentByArtist - 2) * RECOMMENDATION_WEIGHTS.artistFatigue;
    reasons.push({ kind: 'fatigue', weight: fatigue, detail: song.artists[0]?.name });
    score += fatigue;
  }

  // v7.0.0 — session intent: what the listener did in THIS sitting. Artists
  // they keep skipping sink, artists they liked, searched for or hand-queued
  // rise, the energy follows what they finish rather than what they skip, and
  // a song skipped minutes ago is not offered again. Bounded and ramped, so
  // one action never outweighs weeks of taste.
  const intent = ctx.sessionIntent;
  if (intent && frame.intentRamp > 0) {
    let term = 0;
    if (lead) term += (intent.artistPull[lead] ?? 0) * RECOMMENDATION_WEIGHTS.intentArtist;
    if (song.language) term += (intent.languagePull[song.language] ?? 0) * RECOMMENDATION_WEIGHTS.intentLanguage;
    if (intent.energySteer !== 0) term += (candidateProfile.energy - 0.5) * intent.energySteer * RECOMMENDATION_WEIGHTS.intentEnergy;
    if (intent.skippedSongIds.has(song.id)) term -= RECOMMENDATION_WEIGHTS.intentSkippedSong;
    term *= frame.intentRamp;
    if (Math.abs(term) > 0.02) reasons.push({ kind: 'intent', weight: term });
    score += term;
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

export function rankCandidates(candidates: Candidate[], ctx: RecommendationContext, onDrop?: (dropped: ScoredCandidate) => void): ScoredCandidate[] {
  const seen = new Set<string>();
  const out: ScoredCandidate[] = [];
  const frame = buildScoringFrame(ctx);
  for (const c of candidates) {
    if (seen.has(c.song.id)) continue;
    seen.add(c.song.id);
    const scored = scoreCandidate(c, ctx, frame);
    if (scored.score > 0) out.push(scored);
    else onDrop?.(scored);
  }
  out.sort((a, b) => b.score - a.score);
  return rerankCandidates(shuffleTiers(out, ctx.salt), ctx);
}
