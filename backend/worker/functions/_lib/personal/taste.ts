/**
 * The taste model's JSON half: an empty model, the fold that moves it with a
 * batch of events, the decay that runs first, and the summary the composer
 * reads. Everything here is pure and deterministic — the weights and
 * half-lives are the device's (frontend/src/services/personalization/
 * eventWeights.ts), so the two tiers agree about what a like is worth.
 *
 * Storage (load, save with the version check) is in store.ts.
 */
import type { Affinity, ArtistAffinity, EventKind, PersonalEvent, SongAffinity, SongFacts, SongRow, Taste, TasteFacets, TasteMode, TasteSummary } from './types';

export const DAY_MS = 86_400_000;
export const SCORE_HALF_LIFE_DAYS = 14;
export const SKIP_HALF_LIFE_DAYS = 30;
export const MAX_AFFINITY = 60;
export const MAX_ARTISTS = 300;
export const MAX_SONGS = 500;
export const MAX_FACET_KEYS = 50;

/** What each event is worth, as on the device. A skip also takes its play back. */
export const EVENT_WEIGHTS: Readonly<Record<EventKind, number>> = {
  play: 1,
  radio_start: 1,
  search_play: 1.5,
  complete: 2,
  like: 3,
  unlike: -3,
  dislike: -1.5,
  save: 1,
  queue: 0.5,
  skip: -1.75,
  shown: 0,
};

const PLAY_KINDS: ReadonlySet<EventKind> = new Set(['play', 'radio_start', 'search_play']);

export const TASTE_MODES: readonly TasteMode[] = ['familiar', 'balanced', 'discover'];
export const isTasteMode = (v: unknown): v is TasteMode => typeof v === 'string' && (TASTE_MODES as readonly string[]).includes(v);

const emptyFacets = (): TasteFacets => ({ moods: {}, genres: {}, decades: {}, energy: { sum: 0, n: 0 } });

export const emptySummary = (): TasteSummary => ({
  topArtists: [], topLanguages: [], moods: [], decades: [], peakHours: [],
  totals: { plays: 0, completes: 0, skips: 0, likes: 0 }, lines: [],
});

export function emptyTaste(now = Date.now()): Taste {
  return {
    artists: {}, languages: {}, facets: emptyFacets(), hours: {}, songs: {},
    summary: emptySummary(), mode: 'balanced', eventsSeen: 0, version: 1, updatedAt: now,
  };
}

const affinity = (now: number): Affinity => ({ score: 0, plays: 0, completes: 0, skips: 0, last: now });

const clampScore = (n: number): number => Math.max(-MAX_AFFINITY, Math.min(MAX_AFFINITY, n));

function bump(a: Affinity, kind: EventKind, weight: number, at: number): void {
  a.score = clampScore(a.score + weight);
  if (PLAY_KINDS.has(kind)) a.plays += 1;
  if (kind === 'complete') a.completes += 1;
  if (kind === 'skip') a.skips += 1;
  if (at > a.last) a.last = at;
}

/** Positive and negative scores both fade toward zero; skip counts fade slower. */
export function decayTaste(t: Taste, now: number): Taste {
  const days = Math.max(0, (now - t.updatedAt) / DAY_MS);
  if (days < 0.25) return t;
  const f = Math.pow(0.5, days / SCORE_HALF_LIFE_DAYS);
  const fs = Math.pow(0.5, days / SKIP_HALF_LIFE_DAYS);
  const fade = (a: Affinity) => {
    a.score = Math.abs(a.score * f) < 0.01 ? 0 : a.score * f;
    a.skips = a.skips * fs < 0.05 ? 0 : a.skips * fs;
  };
  for (const a of Object.values(t.artists)) fade(a);
  for (const a of Object.values(t.languages)) fade(a);
  for (const a of Object.values(t.songs)) fade(a);
  for (const map of [t.facets.moods, t.facets.genres, t.facets.decades]) {
    for (const k of Object.keys(map)) {
      map[k] *= f;
      if (map[k] < 0.01) delete map[k];
    }
  }
  t.updatedAt = now;
  return t;
}

const decadeOf = (year: number | null): string | null => (year && year > 1900 && year < 2100 ? `${Math.floor(year / 10) * 10}s` : null);

function bumpFacet(map: Record<string, number>, key: string | null | undefined, weight: number): void {
  if (!key || weight === 0) return;
  const k = key.toLowerCase().slice(0, 40);
  map[k] = (map[k] ?? 0) + weight;
  if (map[k] <= 0) delete map[k];
}

/** Drop the least recently touched entries past the cap. */
function capMap<T extends Affinity>(map: Record<string, T>, cap: number): void {
  const keys = Object.keys(map);
  if (keys.length <= cap) return;
  keys.sort((a, b) => map[b].last - map[a].last || Math.abs(map[b].score) - Math.abs(map[a].score));
  for (const k of keys.slice(cap)) delete map[k];
}

function capFacets(map: Record<string, number>): void {
  const keys = Object.keys(map);
  if (keys.length <= MAX_FACET_KEYS) return;
  keys.sort((a, b) => map[b] - map[a]);
  for (const k of keys.slice(MAX_FACET_KEYS)) delete map[k];
}

/**
 * Fold a batch into the model. `songs` is what the batch's song ids resolve
 * to (a stored row or the facts the device sent); an event whose song is
 * unknown still counts for the song's own affinity. Events are applied in
 * time order, so the result does not depend on the batch's order.
 */
export function foldEvents(input: Taste, events: readonly PersonalEvent[], songs: ReadonlyMap<string, SongFacts | SongRow>, now = Date.now()): Taste {
  const t = decayTaste(structuredClone(input), now);
  const ordered = [...events].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  for (const ev of ordered) {
    const weight = EVENT_WEIGHTS[ev.kind] ?? 0;
    const at = Number.isFinite(ev.at) ? ev.at : now;
    const song = songs.get(ev.songId);
    const songId = ev.songId;
    t.eventsSeen += 1;

    if (weight !== 0 || PLAY_KINDS.has(ev.kind) || ev.kind === 'complete' || ev.kind === 'skip') {
      const s = (t.songs[songId] ??= { ...affinity(at), likes: 0 });
      bump(s, ev.kind, weight, at);
      if (ev.kind === 'like') s.likes += 1;
      if (ev.kind === 'unlike') s.likes = Math.max(0, s.likes - 1);
    }
    if (!song) continue;

    const language = typeof song.language === 'string' && song.language ? song.language.toLowerCase() : null;
    if (language && weight !== 0) bump((t.languages[language] ??= affinity(at)), ev.kind, weight, at);

    const artists = Array.isArray(song.artists) ? song.artists.slice(0, 3) : [];
    const primaryId = 'artist_id' in song ? song.artist_id : song.artistId;
    const primaryName = song.artist;
    const seen = new Set<string>();
    const credits = artists.length ? artists : primaryName ? [{ id: primaryId ?? null, name: primaryName }] : [];
    credits.forEach((a, i) => {
      const key = a.id ?? (a.name ? `name:${a.name.toLowerCase()}` : null);
      if (!key || seen.has(key) || weight === 0) return;
      seen.add(key);
      const share = i === 0 ? 1 : 0.5;
      const row = (t.artists[key] ??= { ...affinity(at), name: a.name });
      row.name = a.name || row.name;
      bump(row, ev.kind, weight * share, at);
    });

    if (weight > 0) {
      const facets = song.facets ?? {};
      bumpFacet(t.facets.moods, facets.mood, weight);
      bumpFacet(t.facets.genres, facets.genre, weight);
      bumpFacet(t.facets.decades, decadeOf(song.year), weight);
      if (typeof facets.energy === 'number' && Number.isFinite(facets.energy)) {
        t.facets.energy.sum += facets.energy * weight;
        t.facets.energy.n += weight;
      }
    }

    if (PLAY_KINDS.has(ev.kind) || ev.kind === 'complete') {
      const hour = ev.context && typeof ev.context.hour === 'number' && ev.context.hour >= 0 && ev.context.hour < 24 ? Math.floor(ev.context.hour) : null;
      if (hour !== null) {
        for (const bucket of ['_all', language].filter((k): k is string => !!k)) {
          const arr = (t.hours[bucket] ??= new Array<number>(24).fill(0));
          arr[hour] += 1;
        }
      }
    }
  }
  capMap(t.artists, MAX_ARTISTS);
  capMap(t.songs, MAX_SONGS);
  capFacets(t.facets.moods);
  capFacets(t.facets.genres);
  capFacets(t.facets.decades);
  t.summary = summarize(t);
  t.updatedAt = now;
  return t;
}

/** 0..1 from an affinity score: a log squash so one binge does not drown everything. */
export const squash = (score: number): number => (score <= 0 ? 0 : Math.log1p(score) / Math.log1p(MAX_AFFINITY));

const topOf = <T extends Affinity>(map: Record<string, T>, n: number): Array<[string, T]> =>
  Object.entries(map).filter(([, a]) => a.score > 0).sort((a, b) => b[1].score - a[1].score).slice(0, n);

const topKeys = (map: Record<string, number>, n: number): string[] => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

const HOUR_WORDS: Array<[number, number, string]> = [[5, 11, 'the morning'], [11, 16, 'the afternoon'], [16, 21, 'the evening'], [21, 29, 'late at night']];

export function summarize(t: Taste): TasteSummary {
  const artists = topOf(t.artists, 8).map(([id, a]) => ({ id, name: a.name, score: Math.round(a.score * 10) / 10 }));
  const langTotal = Object.values(t.languages).reduce((s, a) => s + Math.max(0, a.score), 0);
  const topLanguages = topOf(t.languages, 4).map(([id, a]) => ({ id, share: langTotal > 0 ? Math.round((a.score / langTotal) * 100) / 100 : 0 }));
  const moods = topKeys(t.facets.moods, 3);
  const decades = topKeys(t.facets.decades, 3);
  const all = t.hours._all ?? [];
  const peak = all.length ? Math.max(...all) : 0;
  const peakHours = peak > 0 ? all.map((n, h) => [n, h] as const).filter(([n]) => n >= peak * 0.6).map(([, h]) => h) : [];
  const totals = { plays: 0, completes: 0, skips: 0, likes: 0 };
  for (const s of Object.values(t.songs)) {
    totals.plays += s.plays;
    totals.completes += s.completes;
    totals.skips += s.skips;
    totals.likes += s.likes;
  }
  totals.skips = Math.round(totals.skips);

  const lines: string[] = [];
  if (topLanguages.length) lines.push(`Listens mostly to ${topLanguages.map((l) => `${l.id} (${Math.round(l.share * 100)}%)`).join(', ')}.`);
  if (artists.length) lines.push(`Top artists: ${artists.slice(0, 6).map((a) => a.name).join(', ')}.`);
  if (moods.length || decades.length) {
    const parts: string[] = [];
    if (moods.length) parts.push(`${moods.join(' and ')} songs`);
    if (decades.length) parts.push(`mostly from the ${decades.join(' and ')}`);
    lines.push(`Leans toward ${parts.join(', ')}.`);
  }
  if (peakHours.length) {
    const words = new Set<string>();
    for (const h of peakHours) for (const [from, to, word] of HOUR_WORDS) if ((h >= from && h < to) || (to > 24 && h < to - 24 && h < 5)) words.add(word);
    if (words.size) lines.push(`Plays most in ${[...words].join(' and ')}.`);
  }
  if (totals.plays > 0) {
    const skipRate = totals.plays ? Math.round((totals.skips / totals.plays) * 100) : 0;
    lines.push(`${totals.plays} plays, ${totals.likes} likes, skips ${skipRate}% of what starts.`);
  }
  if (t.mode !== 'balanced') lines.push(t.mode === 'discover' ? 'Wants to discover new music.' : 'Prefers familiar music.');
  return { topArtists: artists, topLanguages, moods, decades, peakHours, totals, lines };
}

/** The account's languages by affinity, strongest first (for catalogue filters). */
export function tasteLanguages(t: Taste, n = 3): string[] {
  return topOf(t.languages, n).map(([id]) => id);
}

/** Songs by affinity, strongest first, optionally only those touched after `after`. */
export function tasteSongs(t: Taste, n = 20, after = 0): Array<[string, SongAffinity]> {
  return Object.entries(t.songs).filter(([, a]) => a.score > 0 && a.last >= after).sort((a, b) => b[1].score - a[1].score).slice(0, n);
}

export const topArtists = (t: Taste, n = 10): Array<[string, ArtistAffinity]> => topOf(t.artists, n);

/** The strongest artist that has a catalogue id (a shelf can fetch more of them), or null. */
export function tasteTopArtistWithId(t: Taste): { id: string; name: string; score: number } | null {
  const hit = topOf(t.artists, 10).find(([key]) => !key.startsWith('name:'));
  return hit ? { id: hit[0], name: hit[1].name, score: hit[1].score } : null;
}
