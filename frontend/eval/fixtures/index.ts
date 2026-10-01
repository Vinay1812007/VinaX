import type { HistoryEntry, Song } from '../../src/types';
import type { AiScript, Behaviour } from '../lib/mocks';
import type { EvalStyle } from '../lib/rules';
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
export const EVAL_FIXTURES_VERSION = '1.3.0'; // 9.0.0 — album/related-artist retrieval, cached embeddings, served songs, a memory sitting, unplayable tracks, sparse history (1.2.0: DJ-remix and folk; 1.1.0: mixed-queue)

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
  /**
   * 8.3.0 — the sitting is in a style. Searches whose query matches `pattern`
   * answer from `search` a page at a time (lib/mocks.ts), as the catalogue
   * answers "telugu dj remix" / "telugu folk songs"; every other search
   * answers from the fixture's ordinary `search`. The report measures the
   * share of each continuation in `kind` (lib/rules.ts `inEvalStyle`).
   */
  style?: { kind: EvalStyle; pattern: RegExp; search: Song[] };
  /** 9.0.0 — album pages the catalogue answers (`getAlbum`), by album id. */
  albums?: Record<string, Song[]>;
  /** 9.0.0 — artist pages' "similar artists", by artist id. */
  similarArtists?: Record<string, Array<{ id: string; name: string }>>;
  /** 9.0.0 — songs only an artist page lists (no search or suggestion returns them). */
  artistSongs?: Song[];
  /** 9.0.0 — learned vectors the device already holds, by song id. */
  embeddings?: Record<string, number[]>;
  /** 9.0.0 — songs another surface (Home, AI Playlist) showed in the last week. */
  served?: Song[];
  /** 9.0.0 — keep the recommendation memories for the sitting: commit each accepted continuation and record how its songs went. */
  memory?: boolean;
  /** 9.0.0 — songs the catalogue cannot stream (their response carried stream URLs for the others). */
  unplayableIds?: string[];
  /**
   * 9.0.0 — the fixture's DECLARED taste: songs this synthetic listener is
   * written to like. "Taste agreement" is the share of queued songs in it —
   * agreement with what the fixture says, never evidence that anyone enjoys them.
   */
  tasteTargets?: string[];
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

  // 8.3.0 — a DJ-remix sitting. A listener who usually plays film songs
  // starts a Telugu DJ remix. The seed's suggestions are mostly popular film
  // songs with three remixes among them; the catalogue's DJ-remix search holds
  // remixes by DJs this listener has never played, among them "Version N"
  // cuts of one remix and another DJ's remix of the seed. The stretch should
  // stay DJ, one remix per song.
  const djArtists = ['డీజే శ్రీను', 'డీజే రాజు', 'పెద్దపులి ఈశ్వర్', 'క్లెమెంట్ రావు', 'అశోక్ కుమార్', 'హేమ చంద్ర'];
  const remix = (id: string, t: number, artist: string, cut = '(DJ Remix Song)'): Song =>
    song(id, { title: `${te.titles[t]} బీట్ ${cut}`, artist, language: 'telugu', album: { id: `al-${id}`, name: `${te.titles[t]} బీట్ ${cut}` }, year: '2024', energy: 0.82 + (t % 3) * 0.04, tempo: 126 + (t % 4) * 4, mood: 'energetic', genre: null, playCount: 900_000 - t * 20_000 });
  const filmOnly = (songs: Song[]): Song[] => songs.map((s) => ({ ...s, genre: 'film', mood: s.mood === 'devotional' ? 'romantic' : s.mood }));
  const djSession = listener(now, 'telugu', { id: 'dj-session', title: 'DJ-remix sitting (Telugu)', notes: 'A DJ remix is playing: what follows should be DJ remixes, one per song, though the seed’s suggestions are mostly film songs.' });
  djSession.seed = remix('seed-dj-session', 0, djArtists[0]);
  djSession.related = [...filmOnly(pool('telugu', { prefix: 'djs-r', count: 12, offset: 1 })), remix('djs-rr0', 1, djArtists[1]), remix('djs-rr1', 2, djArtists[2]), remix('djs-rr2', 3, djArtists[3])];
  djSession.search = filmOnly(pool('telugu', { prefix: 'djs-s', count: 10, offset: 5, artistPattern: [2, 3, 4, 5, 6, 7, 2, 4, 6, 3] }));
  djSession.style = {
    kind: 'dj',
    pattern: /\b(dj|remix)\b/i,
    search: [
      ...Array.from({ length: 12 }, (_, i) => remix(`djs-x${i}`, 4 + i, djArtists[i % djArtists.length])),
      // Two "Version N" cuts of remixes already in the list (same DJ): one of each may ship.
      remix('djs-v3', 4, djArtists[0], '(DJ Remix Song Version 3)'),
      remix('djs-v2', 5, djArtists[1], '(Dj Remix Version 2)'),
      // Another DJ's remix of the seed, and of a song in the list.
      remix('djs-o0', 0, djArtists[3], '- Dj Remix'),
      remix('djs-o6', 6, djArtists[4], '(Remix)'),
    ],
  };

  // 8.3.0 — a folk sitting. Folk songs say so only in their ALBUM ("Telugu
  // Folk Songs Telangana Janapadalu Vol - 6"). The AI DJ answers with an
  // order of its own, which may not trade folk songs for film songs.
  const folkAlbums = ['Telugu Folk Songs Telangana Janapadalu Vol - 6', 'Telangana Janapadalu, Vol. 2', 'Telugu Folk Songs', 'Palle Patalu (Best Folk Songs)', 'Telugu Folk DJ Songs, Vol. 2'];
  const folkSingers = ['వడ్లకొండ అనిల్', 'జాడల రమేష్', 'ఏ. రమాదేవి', 'అకునూరి దేవయ్య', 'మావూరి మల్లేష్', 'సాయి చంద్'];
  const folkSong = (id: string, t: number, singer: string): Song =>
    song(id, { title: `${te.titles[t]} పల్లె పాట`, artist: singer, language: 'telugu', album: { id: `al-folk-${t % folkAlbums.length}`, name: folkAlbums[t % folkAlbums.length] }, year: String(2016 + (t % 8)), energy: 0.55 + (t % 5) * 0.06, tempo: 100 + (t % 5) * 6, mood: null, genre: null, playCount: 500_000 - t * 10_000 });
  const folkSession = listener(now, 'telugu', { id: 'folk-session', title: 'Folk sitting (Telugu), AI DJ answering', notes: 'A Telangana folk song is playing (folk only in its album name): what follows should be folk, and the AI DJ’s order may not trade folk for film songs.', ai: { mode: 'dj', answer: 'reorder' } });
  folkSession.seed = folkSong('seed-folk-session', 0, folkSingers[0]);
  folkSession.related = [...filmOnly(pool('telugu', { prefix: 'folk-r', count: 12, offset: 1 })), folkSong('folk-rr0', 1, folkSingers[1]), folkSong('folk-rr1', 2, folkSingers[2])];
  folkSession.search = filmOnly(pool('telugu', { prefix: 'folk-s', count: 10, offset: 5, artistPattern: [2, 3, 4, 5, 6, 7, 2, 4, 6, 3] }));
  folkSession.style = { kind: 'folk', pattern: /\bfolk\b|janapad/i, search: Array.from({ length: 13 }, (_, i) => folkSong(`folk-x${i}`, 3 + i, folkSingers[i % folkSingers.length])) };

  // 9.0.0 — album and related-artist retrieval. The seed is from a film
  // soundtrack and its suggestions are thin; the album page holds the rest of
  // the soundtrack, and the lead artist's page lists two similar artists whose
  // songs no search returns. The declared taste: the soundtrack and those two.
  const deep = listener(now, 'telugu', { id: 'deep-sources', title: 'Album and related-artist retrieval (Telugu)', notes: 'Thin suggestions; the seed’s album page and its artist’s similar artists hold songs nothing else returns. They should reach the queue, within the discovery budget.' });
  deep.seed = song('seed-deep-sources', { title: te.titles[0], artist: te.artists[0], language: 'telugu', year: '2022', energy: 0.55, tempo: 108, mood: 'romantic', genre: 'film', album: { id: 'al-deep-film', name: te.albums[1] } });
  deep.related = pool('telugu', { prefix: 'deep-r', count: 5, offset: 1 });
  deep.search = pool('telugu', { prefix: 'deep-s', count: 4, offset: 6, artistPattern: [3, 4, 5, 6] });
  const deepAlbum = pool('telugu', { prefix: 'deep-al', count: 7, offset: 20, artistPattern: [1, 5, 2, 7, 1, 5, 2] }).map((s) => ({ ...s, album: { id: 'al-deep-film', name: te.albums[1] }, genre: 'film' }));
  const deepArtists = pool('telugu', { prefix: 'deep-ar', count: 8, offset: 40, artistPattern: [6, 7, 6, 7, 6, 7, 6, 7] });
  deep.albums = { 'al-deep-film': [deep.seed, ...deepAlbum] };
  deep.similarArtists = { [`ar-${te.artists[0]}`]: [{ id: `ar-${te.artists[6]}`, name: te.artists[6] }, { id: `ar-${te.artists[7]}`, name: te.artists[7] }] };
  deep.artistSongs = deepArtists;
  deep.tasteTargets = [...deepAlbum, ...deepArtists].map((s) => s.id);

  // 9.0.0 — cached learned embeddings. The candidates' metadata says nothing
  // about which of them fit; the device's learned vectors do: the listener's
  // taste songs and half the candidates point one way, the other half another.
  // The declared taste is the first half. The same listener without vectors is
  // the control (`embeddings-off`).
  const near = (i: number): number[] => [1, 0.15 + (i % 3) * 0.05, 0, 0.1, 0, 0, 0.05 * (i % 2), 0];
  const far = (i: number): number[] => [0, 0.1, 1, 0, 0.15 + (i % 3) * 0.05, 0, 0, 0.05 * (i % 2)];
  const embedded = listener(now, 'telugu', { id: 'embeddings', title: 'Cached learned embeddings (Telugu)', notes: 'The device holds learned vectors for the taste songs and the candidates; only they tell the fitting candidates apart. Compare with `embeddings-off`.' });
  // A pool three times the sitting, so the order decides what ships (a sitting that empties its pool ships the same songs in any order).
  embedded.related = pool('telugu', { prefix: 'emb-r', count: 40, offset: 1 });
  embedded.search = pool('telugu', { prefix: 'emb-s', count: 20, offset: 5, artistPattern: [2, 3, 4, 5, 6, 7, 2, 4, 6, 3] });
  embedded.embeddings = {};
  for (const s of [...embedded.favorites, ...embedded.history.map((e) => e.song)]) embedded.embeddings[s.id] = near(0);
  const embeddedPool = [...embedded.related, ...embedded.search];
  embeddedPool.forEach((s, i) => { embedded.embeddings![s.id] = i % 2 === 0 ? near(i) : far(i); });
  embedded.tasteTargets = embeddedPool.filter((_, i) => i % 2 === 0).map((s) => s.id);
  const embeddedOff: EvalFixture = { ...embedded, id: 'embeddings-off', title: 'The same listener, no vectors on the device', notes: 'Control for `embeddings`: identical, except the device holds no learned vectors.', embeddings: {} };

  // 9.0.0 — Home showed eight of the seed's strongest suggestions this week.
  const served = listener(now, 'telugu', { id: 'served', title: 'Songs Home showed this week (Telugu)', notes: 'Eight of the strongest suggestions were shown on Home: the served-recently penalty holds them back a little, never as a rule.' });
  served.served = served.related.slice(0, 8);

  // 9.0.0 — a sitting with memory: every accepted continuation is committed,
  // and the listener finishes three of each five and skips the fourth.
  const memorySitting = listener(now, 'telugu', { id: 'memory', title: 'Committed continuations and pick memory (Telugu)', notes: 'Each continuation is committed and its first four songs end (three finished, one skipped): the seed and outcome memories fill as the sitting goes, and no rule may bend for them.', memory: true });

  // 9.0.0 — the catalogue cannot stream every song: the seed's suggestions came
  // with stream URLs for half of them, so the other half are unplayable.
  const unplayable = listener(now, 'telugu', { id: 'unplayable', title: 'Unplayable tracks in the pool (Telugu)', notes: 'The suggestions response carries stream URLs for half its songs; the rest cannot play and must never be queued (the no-audio rule).' });
  unplayable.related = unplayable.related.map((s, i) => (i % 2 === 0 ? { ...s, audio: [{ quality: '160kbps', url: `https://cdn.invalid/${s.id}.mp4` }] } : s));
  unplayable.unplayableIds = unplayable.related.filter((_, i) => i % 2 === 1).map((s) => s.id);

  // 9.0.0 — a listener with three plays and no favourites: barely past cold.
  const sparseHistory = listener(now, 'hindi', { id: 'sparse-history', title: 'Sparse history (three plays, Hindi)', notes: 'Three plays, no favourites, one pinned language: taste is a whisper, so popularity and the seed carry the queue.' });
  sparseHistory.favorites = [];
  sparseHistory.history = sparseHistory.history.slice(0, 3);
  sparseHistory.profile = warmProfile(now, { languages: { hindi: 3 }, artists: [hi.artists[0]], plays: 3 });

  return [cold, warm, familiar, discover, tamil, punjabi, malayalam, mixed, mixedQueue, prefs, skips, partial, offline, sparse, versions, small, kid, muted, hidden, softMuted, djSession, folkSession, deep, embedded, embeddedOff, served, memorySitting, unplayable, sparseHistory];
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
