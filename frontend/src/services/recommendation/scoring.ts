import {
  artistLastSeen,
  artistSkipScore,
  artistWeight,
  languageWeight,
  lowSkipScore,
  preferredEnergy,
  profileConfidence,
  songWeight,
  timeOfDayWeight,
  type TasteProfile,
} from '@/services/personalization/profile';
import { coPlayAffinity, coPlayIndexFor } from './coplay';
import type { Candidate, ReasonComponent, ReasonKind, RecommendationContext, ScoredCandidate } from './types';
import { moodMatchScore } from './mood';
import { buildSongProfile, overlap, type SongProfile } from './profiles';
import { RECOMMENDATION_WEIGHTS, TASTE_WEIGHTS } from './weights';
import { rerankCandidates } from './reranking';
import { songKey } from './songIdentity';
import { dot, embeddingTasteVector, songVector, tasteVector } from './vectors';
import type { Song } from '@/types';

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
  // 8.2.0 — the seed's own album: the same film or record, usually the same composer.
  album: 0.1,
  // 8.2.0 — artists who work with the seed's artist: one step further out than the seed's own.
  'related-artist': 0.1,
  // 8.2.0 — like picks this listener finished or liked before (or, after a cooldown, one of them).
  proven: 0.12,
  // 8.2.0 — the seed's genre or mood in its language: broad, a little above trending.
  genre: 0.07,
};

/** How each source's boost is explained (favourite-artist and -album name what they came from). */
const SOURCE_REASON: Record<Candidate['source'], ReasonKind> = {
  related: 'related',
  'favorite-artist': 'artist',
  'favorite-album': 'related',
  rediscovery: 'rediscovery',
  explore: 'discovery',
  intent: 'intent',
  trending: 'trending',
  history: 'familiar',
  album: 'album',
  'related-artist': 'similar-artist',
  proven: 'proven',
  genre: 'genre',
};

/** 7.2.0 — per extra source that found the same song, capped: agreement is evidence, not a trump card. */
const AGREEMENT_STEP = 0.02;
const AGREEMENT_CAP = 0.04;
/** 7.2.0 — fewest plays on a weekday before the weekday term says anything. */
const MIN_WEEKDAY_PLAYS = 5;

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
  /** 0 = Sunday. */
  day: number;
  /** 8.2.0 — the listener's taste in the on-device vector space (null with no favourites or history). */
  taste: Float32Array | null;
  /** 8.2.0 — the same in a learned embedding space, from vectors the device holds (null when it holds too few). */
  embeddingTaste: Float32Array | null;
  /**
   * 8.2.0 — the pool's mean embedding fit, set by `rankCandidates`. The
   * embedding only moves a candidate's taste fit by how far it sits above or
   * below this, so candidates with and without a cached vector stay comparable.
   */
  embeddingPoolMean: number | null;
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
    day: ctx.dayOfWeek ?? new Date().getDay(),
    taste: tasteVector(ctx.favorites, ctx.history),
    embeddingTaste: ctx.embeddingOf ? embeddingTasteVector(ctx.favorites, ctx.history, ctx.embeddingOf) : null,
    embeddingPoolMean: null,
  };
}

/** A cached learned embedding for a song, or null (a lookup that throws counts as none). */
function embeddingFor(ctx: RecommendationContext, id: string, dims: number): Float32Array | null {
  try {
    const v = ctx.embeddingOf?.(id) ?? null;
    return v && v.length === dims ? v : null;
  } catch {
    return null;
  }
}

/**
 * 8.2.0 — how well a candidate fits the listener's taste, 0..1: the cosine
 * of its on-device vector and the taste vector. When the device holds a
 * learned embedding for the candidate AND for enough taste songs, the fit
 * moves by how far the candidate's embedding cosine sits above or below the
 * pool's mean — the two spaces are never compared with each other.
 */
export function tasteFit(song: Song, ctx: RecommendationContext, frame: ScoringFrame, profile?: SongProfile, classified?: Candidate['classified']): number {
  if (!frame.taste) return 0;
  let fit = Math.max(0, dot(songVector(song, classified, profile), frame.taste));
  if (frame.embeddingTaste && frame.embeddingPoolMean != null) {
    const e = embeddingFor(ctx, song.id, frame.embeddingTaste.length);
    if (e) fit += dot(e, frame.embeddingTaste) - frame.embeddingPoolMean;
  }
  return Math.max(0, Math.min(1, fit));
}

/**
 * 7.2.0 — the weekday term, made candidate-specific. The old term was the
 * listener's play volume on today's weekday: the same number for every
 * candidate, so it could never change an order. This one is how much more
 * (or less) of this weekday's listening is in the candidate's language than
 * of the listener's listening overall: the language's share of this
 * weekday's plays minus its share of all plays (−1..1). 0 without a
 * language, before MIN_WEEKDAY_PLAYS plays on that weekday, or for a profile
 * that predates `languageDays`.
 */
export function weekdayLanguageLift(profile: TasteProfile, language: string | null | undefined, day: number): number {
  const days = profile.languageDays;
  const mine = language && language !== 'unknown' ? days?.[language] : undefined;
  if (!days || !mine) return 0;
  const d = ((day % 7) + 7) % 7;
  let onDay = 0;
  let all = 0;
  for (const h of Object.values(days)) {
    onDay += h[d] ?? 0;
    for (const n of h) all += n;
  }
  if (onDay < MIN_WEEKDAY_PLAYS) return 0;
  return (mine[d] ?? 0) / onDay - mine.reduce((s, n) => s + n, 0) / all;
}

/**
 * Deterministic hybrid scoring. Personalized terms are blended in by
 * `confidence * intensity`, so a cold profile leans on popularity/trending
 * and a warm profile leans on taste — explainable via the reasons array.
 * Pass a `frame` when scoring many candidates against one context.
 *
 * 7.2.0 — every contribution is on the record: each term that moves the
 * score is a reason whose weight is exactly what it added, so the reasons
 * sum to the score. A feature neither song has (energy, tempo, mood, genre,
 * vibe) contributes 0; one inferred from a title or supplied by the
 * classifier counts for less than catalogue metadata (`SongProfile.confidence`).
 */
export function scoreCandidate(c: Candidate, ctx: RecommendationContext, frame: ScoringFrame = buildScoringFrame(ctx)): ScoredCandidate {
  const { profile } = ctx;
  const reasons: ReasonComponent[] = [];
  const song = c.song;
  let score = 0;
  const add = (kind: ReasonKind, weight: number, detail?: string | null): void => {
    if (!weight) return; // zero (and NaN) moves nothing
    score += weight;
    reasons.push(detail ? { kind, weight, detail } : { kind, weight });
  };

  if (song.language && ctx.mutedLanguages.includes(song.language)) {
    return { candidate: c, score: -1, reasons: [{ kind: 'language', weight: -1, detail: 'muted' }] };
  }

  const blend = frame.personalBlend;
  const W = RECOMMENDATION_WEIGHTS;
  const cp = buildSongProfile(song, c.classified);
  const conf = cp.confidence;
  const seedProfile = frame.seedProfile;
  const user = ctx.userProfile;
  const leadName = song.artists[0]?.name;

  // Content similarity against the current seed/session. These terms are
  // intentionally independent, so a dialect or genre can be tuned without
  // changing the rest of the model. Each is as strong as the weaker side's evidence.
  if (seedProfile) {
    const sc = seedProfile.confidence;
    add('mood', moodMatchScore(cp.mood, seedProfile.mood) * W.mood * Math.min(conf.mood, sc.mood), seedProfile.mood);
    add('vibe', overlap(cp.vibes, seedProfile.vibes) * W.vibe * Math.min(conf.vibes, sc.vibes));
    add('genre', overlap(cp.genres, seedProfile.genres) * W.genre * Math.min(conf.genres, sc.genres));
    if (cp.language && cp.language === seedProfile.language) add('language', W.language, cp.language);
    if (cp.dialect && cp.dialect === seedProfile.dialect) add('dialect', W.dialect, cp.dialect);
    if (cp.subLanguage && cp.subLanguage === seedProfile.subLanguage) add('dialect', W.dialect * 0.65, cp.subLanguage);
    add('energy', (1 - Math.abs(cp.energy - seedProfile.energy)) * W.energy * Math.min(conf.energy, sc.energy));
    add('tempo', (1 - Math.min(1, Math.abs(cp.tempo - seedProfile.tempo) / 80)) * W.tempo * Math.min(conf.tempo, sc.tempo));
  }

  if (user) {
    const genreAffinity = cp.genres.reduce((m, g) => Math.max(m, user.genres[g] ?? 0), 0);
    const vibeAffinity = cp.vibes.reduce((m, v) => Math.max(m, user.vibes[v] ?? 0), 0);
    add('genre', (genreAffinity / frame.maxGenre) * W.genre * 0.6 * conf.genres);
    add('vibe', (vibeAffinity / frame.maxVibe) * W.vibe * 0.6 * conf.vibes);
    if (cp.dialect && user.dialects[cp.dialect]) add('dialect', W.dialect * 0.4, cp.dialect);
    if (cp.subLanguage && user.subLanguages[cp.subLanguage]) add('dialect', W.dialect * 0.25, cp.subLanguage);
    if (user.avgEnergy != null) add('energy', (1 - Math.abs(cp.energy - user.avgEnergy)) * W.energy * 0.35 * conf.energy, 'your usual energy');
    if (user.avgTempo != null) add('tempo', (1 - Math.min(1, Math.abs(cp.tempo - user.avgTempo) / 80)) * W.tempo * 0.35 * conf.tempo);
    if (user.likedSongIds.has(song.id)) add('likes', W.likes);
    if (user.skippedSongIds.has(song.id)) add('low-skip', -W.skips);
    if (user.recentSongIds.has(song.id)) add('history', -W.history);
  }

  const pinned = song.language != null && ctx.pinnedLanguages.includes(song.language);
  add('language', (languageWeight(profile, song.language) * 0.3 + (pinned ? 0.12 : 0)) * blend, song.language);

  const artistIds = song.artists.map((a) => a.id).filter(Boolean);
  const artistNames = song.artists.map((a) => a.name);
  const rawArtW = artistWeight(profile, artistIds, artistNames);
  add('artist', rawArtW * 0.3 * blend, leadName);

  // Roadmap O.3 — co-play similarity: candidates by artists this listener
  // plays in the same sitting as the seed's artists (catalog recommendation set
  // ctx.coPlaySeed). Entirely on-device; index memoized per history state.
  if (ctx.coPlaySeed && ctx.history.length >= 8) add('co-play', coPlayAffinity(coPlayIndexFor(ctx.history), ctx.coPlaySeed, song) * 0.14 * blend, leadName);

  // Recency boost: artists you've played in the last week stay "hot".
  const lastSeen = artistLastSeen(profile, artistIds, artistNames);
  if (lastSeen && Date.now() - lastSeen < 7 * 86_400_000) add('artist', 0.05 * blend, leadName);

  add('popularity', song.playCount ? Math.min(Math.log10(song.playCount + 1) / 8, 1) * W.popularity * 3 : 0.04);

  // 8.2.0 — taste fit: the whole-song resemblance to what the listener loves
  // and plays lately (artists, album, language, genres, mood, vibes, decade
  // at once), which the per-feature terms above only see one at a time.
  add('taste', tasteFit(song, ctx, frame, cp, c.classified) * TASTE_WEIGHTS.tasteFit * blend);

  // 8.2.0 — no surface re-serves what another just showed, and asking again
  // from the same song does not hand back the same opening: small penalties,
  // never rules — a song that is clearly the best fit still wins.
  if (ctx.servedKeys?.size && ctx.servedKeys.has(songKey(song))) add('served', -TASTE_WEIGHTS.servedRecently, 'shown recently');
  if (ctx.seedRepeatIds?.has(song.id)) add('served', -TASTE_WEIGHTS.seedRepeat, 'same song, same opening');

  // Time-of-day affinity: boost languages you tend to play around this hour.
  add('time', timeOfDayWeight(profile, song.language, ctx.hour) * 0.08 * blend);

  // v6.4.0 — song affinity: a song you keep finishing earns its own term,
  // distinct from its artist (a favourite album track vs. the artist's catalogue).
  add('song', songWeight(profile, song.id) * W.songAffinity * blend);

  // 7.2.0 — weekday rhythm, per language (see weekdayLanguageLift): a weekend
  // Hindi listener gets Hindi lifted on Saturdays and Telugu on weekdays.
  add('day', Math.max(-1, Math.min(1, 2 * weekdayLanguageLift(profile, song.language, frame.day))) * W.dayOfWeek * blend, song.language);

  // v6.4.0 — persisted energy preference (from completed plays) when the
  // session-derived average is not available yet.
  if (user && user.avgEnergy == null) {
    const pref = preferredEnergy(profile);
    if (pref != null) add('energy', (1 - Math.abs(cp.energy - pref)) * W.energy * 0.3 * blend * conf.energy, 'your usual energy');
  }

  // Mood continuity: nudge toward candidates whose mood matches the session's
  // mood (session-based, so it applies even for a cold profile).
  if (ctx.sessionMood) add('mood', (moodMatchScore(cp.mood, ctx.sessionMood) - 0.4) * 0.12 * conf.mood, ctx.sessionMood);

  // Package A1 — session vector (energy + language momentum). Blended at a
  // gentle ~0.10 so the current-mood arc colours the ordering without
  // overriding long-term taste. The vector strengthens as more songs play
  // this session (sessionSize), fading in from a single-track fluke.
  if (typeof ctx.sessionEnergy === 'number') {
    const ramp = Math.min(1, (ctx.sessionSize ?? 0) / 5); // full weight after ~5 plays
    // Closeness on the energy axis, signed around the midpoint: identical
    // energy → +, opposite → −. Max ±0.07 at full ramp and full confidence.
    const energyNudge = (0.5 - Math.abs(cp.energy - ctx.sessionEnergy)) * 0.14 * ramp * conf.energy;
    // Language momentum: you're on a run in one language right now. Small,
    // additive, distinct from the long-term pinned-language preference.
    const langMomentum = ctx.sessionLanguage && song.language === ctx.sessionLanguage ? 0.03 * ramp : 0;
    add('session', energyNudge + langMomentum);
  }

  // Skip aversion (signed around 0.5): reward what you finish, demote what you skip.
  if (song.language && profile.languages[song.language]) add('low-skip', (lowSkipScore(profile.languages[song.language]) - 0.5) * 0.2 * blend, song.language);
  add('low-skip', (artistSkipScore(profile, artistIds, artistNames) - 0.5) * 0.14 * blend, leadName);

  add(SOURCE_REASON[c.source], SOURCE_BOOST[c.source], c.source === 'explore' ? song.language : c.source === 'genre' ? undefined : c.source !== 'trending' && c.source !== 'history' && c.source !== 'rediscovery' && c.source !== 'intent' ? c.seedTitle : undefined);

  // 7.2.0 — several independent sources found this song: a little more
  // confidence it belongs, bounded so it never outweighs a real taste match.
  const agreeing = new Set(c.sources ?? [c.source]);
  if (agreeing.size > 1) add('agreement', Math.min(AGREEMENT_CAP, AGREEMENT_STEP * (agreeing.size - 1)), [...agreeing].join(' + '));

  // 7.2.0 — a verified chart position (or an editorial pick) the listener's
  // region is showing: bounded, and only for a candidate the pool already holds.
  const chart = ctx.trendBonus?.get(song.id) ?? 0;
  if (chart > 0) add('chart', chart, ctx.trendLabel?.get(song.id) ?? null);

  // Freshness: light boost for recent releases (novelty without dominating).
  const year = song.year ? Number(song.year) : null;
  if (year && year >= frame.year - 1) add('fresh', W.freshness);

  // Package A10 — festival/season boost: during a festival window, lift songs in
  // its languages or mood a touch. Off-season the field is absent and this is skipped.
  if (ctx.festival) {
    if (ctx.festival.languages && song.language && ctx.festival.languages.includes(song.language)) add('festival', 0.14, ctx.festival.id);
    if (ctx.festival.moods && ctx.festival.moods.includes(cp.mood)) add('festival', 0.1 * conf.mood, ctx.festival.id);
  }

  // Repetition guard: heavily demote very recently played songs.
  if (profile.recentSongIds.includes(song.id)) add('history', -0.5);

  // Package C3 — hand-tuned taste dials. Small signed linear nudges that vanish
  // at the neutral 0.5 default (an untouched profile scores exactly as before)
  // and are gated behind the optional field, so cold profiles pay nothing.
  const dials = profile.sliders;
  if (dials) {
    // Familiar ↔ adventurous: adventurous lifts discovery sources and demotes
    // the over-familiar; familiar does the reverse. Symmetric around neutral.
    const adv = (dials.adventurous - 0.5) * 2;
    const discovery = c.source === 'explore' || c.source === 'rediscovery' || c.source === 'trending' || c.source === 'related';
    add('dial', adv * ((discovery ? 0.05 : 0) - rawArtW * 0.06), 'adventurous');
    // Classics ↔ recent: map release age to a signed recency axis (+new, −old).
    if (year) {
      const age = frame.year - year;
      const yr = age <= 1 ? 1 : age >= 9 ? -1 : (5 - age) / 4;
      add('dial', (dials.recency - 0.5) * 2 * yr * 0.06, 'recency');
    }
    // Melody ↔ beats: reward candidates near the preferred end of the energy axis.
    add('dial', (dials.energy - 0.5) * 2 * (cp.energy - 0.5) * 0.1 * conf.energy, 'energy');
    // Vocal ↔ instrumental: title-detectable instrumentals only.
    if (INSTRUMENTAL_RE.test(song.title)) add('dial', -((dials.vocalness - 0.5) * 2) * 0.06, 'vocal');
  }

  // v7.0.0 — Familiar / Balanced / Discover. One signed swing between novelty
  // and familiarity: 0 = a song already played, 0.5 = a known artist's unheard
  // song, 1 = an artist never played. `lean` is the mode plus what this
  // sitting's behaviour asks for (a skip streak leans familiar, a long run of
  // completions earns room to roam), so Balanced stays exactly neutral until
  // the listener's own actions tip it.
  const lead = lower(leadName);
  if (frame.lean !== 0) {
    const novelty = frame.playedSongIds.has(song.id) ? 0 : lead && frame.knownArtists.has(lead) ? 0.5 : 1;
    const swing = frame.lean * (novelty - 0.5) * W.novelty;
    add(frame.lean > 0 ? 'discovery' : 'familiar', swing, frame.lean > 0 && swing > 0 ? (novelty === 1 ? 'new-artist' : 'new-song') : undefined);
  }

  // v7.0.0 — artist fatigue: the third, fourth… song by one lead artist inside
  // the last ten plays costs a little more each time. Long-term affinity is
  // untouched; this only spaces an artist out while they are over-present.
  const recentByArtist = lead ? frame.recentArtistCounts.get(lead) ?? 0 : 0;
  if (recentByArtist > 2) add('fatigue', -Math.min(4, recentByArtist - 2) * W.artistFatigue, leadName);

  // v7.0.0 — session intent: what the listener did in THIS sitting. Artists
  // they keep skipping sink, artists they liked, searched for or hand-queued
  // rise, the energy follows what they finish rather than what they skip, and
  // a song skipped minutes ago is not offered again. Bounded and ramped, so
  // one action never outweighs weeks of taste. Reads nothing from the
  // long-term profile, and writes nothing to it.
  const intent = ctx.sessionIntent;
  if (intent && frame.intentRamp > 0) {
    let term = 0;
    if (lead) term += (intent.artistPull[lead] ?? 0) * W.intentArtist;
    if (song.language) term += (intent.languagePull[song.language] ?? 0) * W.intentLanguage;
    if (intent.energySteer !== 0) term += (cp.energy - 0.5) * intent.energySteer * W.intentEnergy * conf.energy;
    if (intent.skippedSongIds.has(song.id)) term -= W.intentSkippedSong;
    add('intent', term * frame.intentRamp);
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
  // 8.2.0 — the embedding refinement needs the pool's own mean, and a pool
  // where too few songs have a cached vector does not get one at all.
  if (frame.embeddingTaste) {
    let sum = 0;
    let n = 0;
    for (const c of candidates) {
      const e = embeddingFor(ctx, c.song.id, frame.embeddingTaste.length);
      if (!e) continue;
      sum += dot(e, frame.embeddingTaste);
      n += 1;
    }
    if (n >= 3) frame.embeddingPoolMean = sum / n;
    else frame.embeddingTaste = null;
  }
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
