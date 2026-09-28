import type { HistoryEntry, Song } from '../../src/types';
import type { AiScript, Behaviour } from '../lib/mocks';
import { pool, song, versionFamily, WORDS, type LangId } from './catalogue';

/**
 * The evaluation fixtures, version 1.0.0.
 *
 * Every fixture is a pure function of the timestamp the harness passes in:
 * no clock, no randomness, no network. A fixture describes a listener (taste
 * profile, history, favourites, settings, restrictions), the catalogue the
 * sources would return, what goes wrong with those sources, and what the AI
 * lane answers.
 *
 * Bump EVAL_FIXTURES_VERSION whenever a fixture changes, or two reports stop
 * being comparable.
 */
export const EVAL_FIXTURES_VERSION = '1.1.0'; // 8.1.0 — the mixed-queue scenario

/** Far enough ahead that a soft mute is active whenever the evaluation runs, without reading the clock. */
export const FAR_FUTURE = 4_102_444_800_000;

export interface Affinity {
  score: number;
  plays: number;
  completes: number;
  skips: number;
  lastTs: number;
}

export interface EvalProfile {
  version: 1;
  createdAt: number;
  updatedAt: number;
  languages: Record<string, Affinity>;
  artists: Record<string, Affinity & { name: string }>;
  songs: Record<string, Affinity>;
  hourHistogram: number[];
  dayHistogram: number[];
  hourBuckets: Record<string, number[]>;
  totals: { plays: number; completes: number; skips: number; favorites: number; queueAdds: number };
  recentSongIds: string[];
  skippedSongIds: string[];
  likedSongIds: string[];
  softMuted: Record<string, { until: number }>;
}

export interface EvalSessionIntent {
  skipStreak: number;
  completionStreak: number;
  artistPull: Record<string, number>;
  languagePull: Record<string, number>;
  skippedSongIds: Set<string>;
  energySteer: number;
  discoveryAppetite: number;
  size: number;
}

export interface EvalFixture {
  id: string;
  title: string;
  /** What this fixture is meant to catch. */
  notes: string;
  seed: Song;
  related: Song[];
  search: Song[];
  outage?: { suggestions?: Behaviour; search?: Behaviour };
  discoveryMode: 'familiar' | 'balanced' | 'discover';
  pinnedLanguages: string[];
  mutedLanguages: string[];
  kidMode: boolean;
  /** Artist display names on the never-play list. */
  hiddenArtists: string[];
  hiddenSongIds: string[];
  favorites: Song[];
  history: HistoryEntry[];
  profile: EvalProfile;
  sessionIntent?: EvalSessionIntent;
  /** 8.1.0 — 'mix' lets the listener's other languages into a stretch; absent = the seed's language only. */
  queueLanguages?: 'one' | 'mix';
  ai: AiScript;
  /** Batches of five to plan in one sitting. */
  batches: number;
}

function emptyProfile(now: number): EvalProfile {
  return {
    version: 1,
    createdAt: now - 120 * 86_400_000,
    updatedAt: now,
    languages: {},
    artists: {},
    songs: {},
    hourHistogram: new Array(24).fill(0),
    dayHistogram: new Array(7).fill(0),
    hourBuckets: {},
    totals: { plays: 0, completes: 0, skips: 0, favorites: 0, queueAdds: 0 },
    recentSongIds: [],
    skippedSongIds: [],
    likedSongIds: [],
    softMuted: {},
  };
}

interface WarmOptions {
  languages: Partial<Record<LangId, number>>;
  /** Artist display names the listener has played. */
  artists: string[];
  plays?: number;
  softMuted?: string[];
  recentSongIds?: string[];
  skippedSongIds?: string[];
}

function warmProfile(now: number, o: WarmOptions): EvalProfile {
  const p = emptyProfile(now);
  const plays = o.plays ?? 60;
  p.totals = { plays, completes: Math.round(plays * 0.6), skips: Math.round(plays * 0.1), favorites: 4, queueAdds: 2 };
  let i = 0;
  for (const [language, weight] of Object.entries(o.languages)) {
    p.languages[language] = { score: weight ?? 10, plays: Math.round(plays * 0.6), completes: Math.round(plays * 0.4), skips: 2, lastTs: now - (i += 1) * 3_600_000 };
  }
  o.artists.forEach((name, n) => {
    p.artists[name.toLowerCase()] = { name, score: 14 - n, plays: 9 - n, completes: 6 - n, skips: 0, lastTs: now - (n + 1) * 7_200_000 };
  });
  p.recentSongIds = o.recentSongIds ?? [];
  p.skippedSongIds = o.skippedSongIds ?? [];
  for (const name of o.softMuted ?? []) p.softMuted[name.toLowerCase()] = { until: FAR_FUTURE };
  p.hourHistogram[20] = plays;
  return p;
}

/** Plays, newest first, one every twenty minutes back from `now`. */
function playsOf(songs: Song[], now: number): HistoryEntry[] {
  return songs.map((s, i) => ({ song: s, ts: now - (i + 1) * 1_200_000, completed: i % 4 !== 3 }));
}

/** The common shape: a seed, a pool from the seed's language, a warm-ish listener. */
function listener(now: number, language: LangId, over: Partial<EvalFixture> & { id: string; title: string; notes: string }): EvalFixture {
  const words = WORDS[language];
  const seed = song(`seed-${over.id}`, { title: words.titles[0], artist: words.artists[0], language, year: '2020', energy: 0.55, tempo: 110, mood: 'romantic', genre: 'film', album: { id: `al-${language}-seed`, name: words.albums[0] } });
  const related = pool(language, { prefix: `${over.id}-r`, count: 16, offset: 1 });
  const search = pool(language, { prefix: `${over.id}-s`, count: 10, offset: 5, artistPattern: [2, 3, 4, 5, 6, 7, 2, 4, 6, 3] });
  const heard = pool(language, { prefix: `${over.id}-h`, count: 8, offset: 9, artistPattern: [0, 1, 2, 0, 1, 2, 0, 1] });
  return {
    seed,
    related,
    search,
    discoveryMode: 'balanced',
    pinnedLanguages: [language],
    mutedLanguages: [],
    kidMode: false,
    hiddenArtists: [],
    hiddenSongIds: [],
    favorites: heard.slice(0, 2),
    history: playsOf(heard, now),
    profile: warmProfile(now, { languages: { [language]: 30 }, artists: words.artists.slice(0, 3) }),
    ai: { mode: 'off' },
    batches: 4,
    ...over,
  };
}

export function buildFixtures(now: number): EvalFixture[] {
  const te = WORDS.telugu;
  const hi = WORDS.hindi;

  // A cold listener: no profile, no history, no favourites.
  const cold = listener(now, 'telugu', { id: 'cold', title: 'Cold listener (Telugu)', notes: 'No profile, no history, no favourites: every artist is unknown, so familiar-first has nothing familiar to open with.' });
  cold.profile = emptyProfile(now);
  cold.history = [];
  cold.favorites = [];
  cold.pinnedLanguages = [];

  const warm = listener(now, 'telugu', { id: 'warm', title: 'Warm listener (Telugu), AI DJ answering', notes: 'A full profile with the AI DJ returning an order of its own: the refinement must pass the same rules.', ai: { mode: 'dj', answer: 'reorder' } });

  const familiar = listener(now, 'telugu', { id: 'familiar', title: 'Telugu, Familiar mode', notes: 'Familiar mode: a 5 % discovery allocation and known ground as a candidate source.', discoveryMode: 'familiar' });

  const discover = listener(now, 'hindi', { id: 'discover', title: 'Hindi, Discover mode, AI unavailable', notes: 'Discover mode: 45 % of a stretch may go to never-played artists, and the language lock still holds.', discoveryMode: 'discover', ai: { mode: 'dj', answer: 'unavailable' } });

  const tamil = listener(now, 'tamil', { id: 'tamil', title: 'Tamil, AI DJ times out', notes: 'The DJ never answers in time: the local order must already be the queue.', ai: { mode: 'dj', answer: 'timeout' } });

  const punjabi = listener(now, 'punjabi', { id: 'punjabi', title: 'Punjabi', notes: 'A second Indic script, with the AI switched off.' });

  const malayalam = listener(now, 'malayalam', { id: 'malayalam', title: 'Malayalam, Familiar mode', notes: 'A third Indic script; Familiar mode over a small artist set.', discoveryMode: 'familiar' });

  // Mixed-language listener: the seed is Hindi, the pool is not.
  const mixed = listener(now, 'hindi', { id: 'mixed', title: 'Mixed-language profile (Hindi seed)', notes: 'The listener plays Hindi, Telugu and Tamil; the pool is mixed. The queue still speaks the seed’s language.' });
  mixed.pinnedLanguages = ['hindi', 'telugu', 'tamil'];
  mixed.profile = warmProfile(now, { languages: { hindi: 30, telugu: 22, tamil: 14 }, artists: [...hi.artists.slice(0, 2), ...te.artists.slice(0, 2)] });
  mixed.related = [...pool('hindi', { prefix: 'mixed-r', count: 8, offset: 1 }), ...pool('telugu', { prefix: 'mixed-t', count: 6, offset: 2 }), ...pool('tamil', { prefix: 'mixed-x', count: 6, offset: 3 })];
  mixed.search = pool('hindi', { prefix: 'mixed-s', count: 6, offset: 9, artistPattern: [3, 4, 5, 6, 7, 3] });
  mixed.ai = {
    mode: 'dj',
    answer: 'rulebreak',
    // What an AI must never get past validation: another language, an explicit cut, a hidden artist's song.
    outsiders: [
      song('mixed-bad-lang', { title: WORDS.tamil.titles[5], artist: WORDS.tamil.artists[5], language: 'tamil' }),
      song('mixed-bad-explicit', { title: hi.titles[10], artist: hi.artists[6], language: 'hindi', explicit: true }),
      song('mixed-bad-hidden', { title: hi.titles[11], artist: hi.artists[7], language: 'hindi' }),
    ],
  };
  mixed.hiddenArtists = [hi.artists[7]];

  // Mixed preferences: two clusters, quiet melodies and loud dance cuts.
  // 8.1.0 — the same listener with the mix policy on: songs from their other
  // languages may follow the Hindi seed; Hindi opens the stretch, never two
  // language changes in a row, and a language they never chose stays out.
  const mixedQueue = listener(now, 'hindi', { id: 'mixed-queue', title: 'Mixed-language profile, queue languages: mix (8.1)', notes: 'Hindi seed, Hindi + Telugu + Tamil listener, mix policy on: the queue may change language within the rules.', queueLanguages: 'mix' });
  mixedQueue.pinnedLanguages = ['hindi', 'telugu', 'tamil'];
  mixedQueue.profile = warmProfile(now, { languages: { hindi: 30, telugu: 22, tamil: 14 }, artists: [...hi.artists.slice(0, 2), ...te.artists.slice(0, 2)] });
  // Enough Hindi for a whole sitting (the `mixed` fixture starves its lock on purpose; this one measures the mix rules under supply).
  mixedQueue.related = [...pool('hindi', { prefix: 'mixq-r', count: 26, offset: 1 }), ...pool('telugu', { prefix: 'mixq-t', count: 8, offset: 2 }), ...pool('tamil', { prefix: 'mixq-x', count: 8, offset: 3 }), ...pool('punjabi', { prefix: 'mixq-p', count: 4, offset: 4 })];
  mixedQueue.search = [...pool('hindi', { prefix: 'mixq-s', count: 12, offset: 9, artistPattern: [3, 4, 5, 6, 7, 3, 8, 9, 4, 5, 6, 7] }), ...pool('telugu', { prefix: 'mixq-st', count: 4, offset: 5 })];

  const prefs = listener(now, 'telugu', { id: 'prefs', title: 'Mixed preferences (quiet and loud)', notes: 'Two clusters in one pool: the arc and the energy step rules decide the order.' });
  prefs.related = [
    ...pool('telugu', { prefix: 'prefs-quiet', count: 8, offset: 1 }).map((s) => ({ ...s, energy: 0.15, tempo: 72, mood: 'melancholy' })),
    ...pool('telugu', { prefix: 'prefs-loud', count: 8, offset: 6, artistPattern: [4, 5, 6, 7, 4, 5, 6, 7] }).map((s) => ({ ...s, energy: 0.92, tempo: 150, mood: 'energetic' })),
  ];

  // A skip streak: the sitting says "not this".
  const skips = listener(now, 'telugu', { id: 'skips', title: 'Repeated skips (a skip streak)', notes: 'Three skips in a row: the arc comes up, the discovery appetite drops, and the skipped songs are out of the pool.' });
  skips.sessionIntent = {
    skipStreak: 3,
    completionStreak: 0,
    artistPull: { [te.artists[3].toLowerCase()]: -0.8, [te.artists[4].toLowerCase()]: -0.5 },
    languagePull: { telugu: -0.2 },
    skippedSongIds: new Set([skips.related[0].id, skips.related[1].id, skips.related[2].id]),
    energySteer: 0.12,
    discoveryAppetite: -0.6,
    size: 6,
  };

  // Partial outage: the seed's suggestions fail, the searches answer.
  const partial = listener(now, 'telugu', { id: 'partial-outage', title: 'Partial outage (a source throws)', notes: 'The strongest source is down: the pool shrinks, and nothing else may break.', outage: { suggestions: 'throw' } });
  partial.search = pool('telugu', { prefix: 'partial-s', count: 12, offset: 4 });

  // Full outage: nothing answers.
  const offline = listener(now, 'telugu', { id: 'offline', title: 'Offline (every source throws)', notes: 'No candidates at all: an empty plan, no crash, no rule broken.', outage: { suggestions: 'throw', search: 'throw' } });

  // Sparse metadata: no energy, tempo, mood, genre, year or duration.
  const sparse = listener(now, 'telugu', { id: 'sparse', title: 'Sparse metadata (no energy, tempo, mood or year)', notes: 'The classifier never answered: the arc has to work from what the catalogue gives.' });
  sparse.related = pool('telugu', { prefix: 'sparse-r', count: 14, offset: 1, sparse: true });
  sparse.search = pool('telugu', { prefix: 'sparse-s', count: 8, offset: 7, sparse: true, artistPattern: [3, 4, 5, 6, 7, 3, 4, 5] });

  // Remixes and version families, plus the Unicode edges of the identity contract.
  const versions = listener(now, 'telugu', { id: 'versions', title: 'Remixes and version families', notes: 'One work, many cuts — plus a zero-width joiner, a Latin accent and a featured credit. One cut of a work may ship.' });
  const family = versionFamily('versions-a', song('versions-a', { title: te.titles[3], artist: te.artists[4], language: 'telugu', energy: 0.5, tempo: 100, year: '2016', mood: 'romantic' }));
  const zwjBase = song('versions-zwj-plain', { title: WORDS.malayalam.titles[9], artist: WORDS.malayalam.artists[2], language: 'telugu', energy: 0.4, tempo: 95, year: '2015' });
  const accented = song('versions-accent-a', { title: 'Café Sundays', artist: 'Café Ravi', language: 'telugu', energy: 0.6, tempo: 105, year: '2018' });
  versions.related = [
    ...family,
    zwjBase,
    song('versions-zwj-joined', { ...zwjBase, id: 'versions-zwj-joined', title: `${WORDS.malayalam.titles[9]}‍` }),
    accented,
    song('versions-accent-b', { ...accented, id: 'versions-accent-b', title: 'Cafe Sundays', artist: 'Cafe Ravi', artists: [{ id: 'ar-cafe-plain', name: 'Cafe Ravi' }] }),
    ...pool('telugu', { prefix: 'versions-r', count: 8, offset: 8 }),
  ];
  // A remix of a song played minutes ago must not come back as "new".
  const recentlyPlayed = song('versions-recent', { title: te.titles[12], artist: te.artists[2], language: 'telugu', energy: 0.45, tempo: 98, year: '2019' });
  versions.history = [{ song: recentlyPlayed, ts: now - 600_000, completed: true }, ...versions.history];
  versions.profile.recentSongIds = [recentlyPlayed.id];
  versions.search = [song('versions-recent-remix', { ...recentlyPlayed, id: 'versions-recent-remix', title: `${recentlyPlayed.title} (Slowed + Reverb)` })];

  // A small catalogue: six candidates for a stretch of five, four times over.
  const small = listener(now, 'telugu', { id: 'small-catalogue', title: 'Small catalogue (6 candidates)', notes: 'Fewer songs than the sitting needs: rules must bend in the documented order, and nothing may repeat.' });
  small.related = pool('telugu', { prefix: 'small-r', count: 6, offset: 2, artistPattern: [0, 1, 2, 0, 3, 1] });
  small.search = [];

  // Kid mode with explicit songs in the pool, and an AI proposing more of them.
  const kid = listener(now, 'telugu', { id: 'kid-mode', title: 'Kid mode with explicit songs in the pool', notes: 'Every explicit cut must be gone — from the pool and from anything the AI proposes.' });
  kid.kidMode = true;
  kid.related = pool('telugu', { prefix: 'kid-r', count: 14, offset: 1, explicitEvery: 3 });
  kid.search = pool('telugu', { prefix: 'kid-s', count: 6, offset: 8, explicitEvery: 2, artistPattern: [4, 5, 6, 7, 4, 5] });
  kid.ai = {
    mode: 'dj',
    answer: 'rulebreak',
    outsiders: [
      song('kid-bad-1', { title: te.titles[14], artist: te.artists[6], language: 'telugu', explicit: true }),
      song('kid-bad-2', { title: te.titles[15], artist: te.artists[7], language: 'telugu', explicit: true }),
    ],
  };

  // Muted languages, with the pool full of them.
  const muted = listener(now, 'telugu', { id: 'muted-languages', title: 'Muted languages (Hindi, English)', notes: 'A muted language never reaches a queue, not even when the pool is mostly that language.' });
  muted.mutedLanguages = ['hindi', 'english'];
  muted.related = [
    ...pool('telugu', { prefix: 'muted-t', count: 6, offset: 1 }),
    ...pool('hindi', { prefix: 'muted-h', count: 8, offset: 1 }),
    ...pool('english', { prefix: 'muted-e', count: 6, offset: 1, artistPattern: [0, 1, 2, 3, 4, 5] }),
  ];
  muted.search = pool('hindi', { prefix: 'muted-hs', count: 6, offset: 6 });

  // Hidden artists — one credited in an Indic script, one in Latin — and a hidden song.
  const hidden = listener(now, 'telugu', { id: 'hidden-artists', title: 'Hidden artists and a hidden song', notes: 'The never-play list must hold for names in any script, including a credit that is only in the subtitle.' });
  hidden.related = [
    ...pool('telugu', { prefix: 'hidden-r', count: 12, offset: 1 }),
    song('hidden-latin', { title: 'Paper Moon Reprise', artist: 'Nadia Rowe', language: 'telugu' }),
    song('hidden-sub', { title: te.titles[13], artist: te.artists[1], subtitle: `${te.artists[1]}, ${te.artists[5]}`, language: 'telugu' }),
  ];
  hidden.hiddenArtists = [te.artists[1], 'Nadia Rowe'];
  hidden.hiddenSongIds = ['hidden-r0', 'hidden-r4'];

  // "Show fewer like this": two soft-muted lead artists.
  const softMuted = listener(now, 'telugu', { id: 'soft-muted', title: 'Soft-muted artists ("show fewer like this")', notes: 'A soft mute is a rule while it lasts: those artists must not come back in a continuation.' });
  softMuted.profile = warmProfile(now, { languages: { telugu: 30 }, artists: te.artists.slice(0, 3), softMuted: [te.artists[0], te.artists[2]] });

  return [cold, warm, familiar, discover, tamil, punjabi, malayalam, mixed, mixedQueue, prefs, skips, partial, offline, sparse, versions, small, kid, muted, hidden, softMuted];
}

/** The fixture the latency conditions use (a warm Telugu listener with a full pool). */
export function latencyFixture(now: number): EvalFixture {
  return listener(now, 'telugu', { id: 'latency', title: 'Latency base (warm Telugu listener)', notes: 'One fixture, seven source and AI conditions.' });
}

/**
 * The same listener with a production-sized pool. 7.2's candidate gather can
 * stop waiting at its soft deadline once the pool is useful (60 songs by
 * default); a small fixture pool never reaches that, so both sizes are
 * measured.
 */
export function largePoolFixture(now: number): EvalFixture {
  const base = latencyFixture(now);
  return {
    ...base,
    id: 'latency-large-pool',
    title: 'Latency base with a production-sized pool',
    related: [...base.related, ...pool('telugu', { prefix: 'large-r', count: 48, offset: 3 })],
    search: [...base.search, ...pool('telugu', { prefix: 'large-s', count: 30, offset: 11, artistPattern: [2, 3, 4, 5, 6, 7] })],
  };
}
