/**
 * The composer: a language model shapes the deterministic Home for this
 * listener and this moment. It may order the shelves, rename each with a
 * one-line reason in the listener's voice, merge two shelves, and add one
 * themed shelf drawn from the pool — and nothing else. Every id it names is
 * checked against the pool; a shelf that loses too many songs falls back to
 * its deterministic form; shelves it leaves out come after the ones it
 * ordered. When it does not answer in time, the deterministic page is served.
 */
import { completeJson } from '../ai/complete';
import type { AiEnv } from '../ai/types';
import { MIN_SHELF, SHELF_SIZE } from './shelves';
import type { Shelf, SongRecord, Taste } from './types';

export const COMPOSE_BUDGET_MS = 8_000;
export const COMPOSE_FIRST_EVENT_MS = 4_000;

export interface ComposeContext {
  taste: Taste;
  firstName: string | null;
  /** Local time words the device sent: hour 0–23 and day 0–6 (Sunday = 0), or null. */
  hour: number | null;
  dow: number | null;
  festival: string | null;
}

export interface ComposedShelf { key: string; title: string; reason: string; songIds?: string[]; from?: string[] }
export interface Composition { greeting: string | null; shelves: ComposedShelf[] }

export const COMPOSE_SYSTEM = `You arrange the Home page of a music app for one listener. You get the shelves the engine built (each with a key, a working title, a reason and sample songs) and a pool of songs with ids. Shape the page for this listener and this moment:
- Order the shelves, strongest first. Keep the ones that matter now; the engine appends any you leave out.
- Rename each shelf in warm, plain words, as a friend who knows their taste would, in English unless the listener's languages suggest otherwise. Titles are at most 6 words. Reasons are one short honest line that says why this shelf exists, never flattery.
- You may merge two shelves into one: {"key": "merge", "from": [key, key], "title", "reason"}.
- You may add ONE themed shelf for the moment (the hour, the day, the season, a festival, a mood you see in their taste): {"key": "themed:<slug>", "title", "reason", "songIds": [8 to 20 ids FROM THE POOL ONLY]}.
- Never invent songs, ids or facts. Never mention the listener's data in numbers. No emoji. No brand names.
Answer with exactly one JSON object: {"greeting": string | null, "shelves": [{"key", "title", "reason", "songIds"?, "from"?}]}. The greeting is one short line (at most 60 characters) or null.`;

const line = (s: SongRecord): string => `${s.id}|${s.title} — ${s.artist}${s.language ? `|${s.language}` : ''}${s.year ? `|${s.year}` : ''}${s.facets?.mood ? `|${s.facets.mood}` : ''}`;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function composePrompt(shelves: readonly Shelf[], pool: readonly SongRecord[], ctx: ComposeContext): string {
  const parts: string[] = [];
  const when: string[] = [];
  if (ctx.hour !== null) when.push(`hour ${ctx.hour}:00`);
  if (ctx.dow !== null) when.push(DAYS[ctx.dow] ?? '');
  if (ctx.festival) when.push(`festival: ${ctx.festival}`);
  parts.push(`<listener>\nname: ${ctx.firstName ?? 'unknown'}\n${ctx.taste.summary.lines.join('\n') || 'No listening yet.'}\n</listener>`);
  parts.push(`<moment>${when.filter(Boolean).join(', ') || 'unknown'}</moment>`);
  parts.push(`<shelves>\n${shelves.map((s) => `- key: ${s.key}\n  title: ${s.title}\n  reason: ${s.reason}\n  songs: ${s.songs.slice(0, 6).map((x) => `${x.title} — ${x.artist}`).join('; ')}`).join('\n')}\n</shelves>`);
  parts.push(`<pool>\n${pool.slice(0, 150).map(line).join('\n')}\n</pool>`);
  return parts.join('\n');
}

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, SHELF_SIZE) : []);

/** The model's answer as a Composition, or null when it is not one. */
export function validateComposition(raw: unknown): Composition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.shelves)) return null;
  const shelves: ComposedShelf[] = [];
  for (const item of o.shelves.slice(0, 16)) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const key = text(s.key, 80);
    const title = text(s.title, 60);
    const reason = text(s.reason, 120) ?? '';
    if (!key || !title) continue;
    shelves.push({ key, title, reason, songIds: ids(s.songIds), from: Array.isArray(s.from) ? s.from.filter((x): x is string => typeof x === 'string').slice(0, 4) : undefined });
  }
  if (!shelves.length) return null;
  return { greeting: text(o.greeting, 60), shelves };
}

/**
 * Apply a composition to the deterministic shelves. Pure: given the same
 * inputs it always builds the same page, so it is tested without a model.
 */
export function applyComposition(c: Composition, shelves: readonly Shelf[], pool: ReadonlyMap<string, SongRecord>): Shelf[] {
  const byKey = new Map(shelves.map((s) => [s.key, s]));
  const used = new Set<string>();
  const out: Shelf[] = [];
  let themed = 0;
  const claimed = new Set<string>();
  const unclaimed = (songs: SongRecord[]) => songs.filter((s) => !claimed.has(s.id));
  const claim = (songs: SongRecord[]) => { for (const s of songs) claimed.add(s.id); };

  for (const cs of c.shelves) {
    if (cs.key === 'merge' && cs.from?.length) {
      const sources = cs.from.map((k) => byKey.get(k)).filter((s): s is Shelf => !!s && !used.has(s.key));
      if (sources.length < 2) continue;
      const songs: SongRecord[] = [];
      const seen = new Set<string>();
      const per = Math.ceil(SHELF_SIZE / sources.length);
      for (const s of sources) for (const song of unclaimed(s.songs).slice(0, per)) if (!seen.has(song.id)) { seen.add(song.id); songs.push(song); }
      if (songs.length < MIN_SHELF) continue;
      for (const s of sources) used.add(s.key);
      claim(songs);
      out.push({ key: `merge:${sources.map((s) => s.key).join('+')}`, title: cs.title, reason: cs.reason || sources[0].reason, songs: songs.slice(0, SHELF_SIZE) });
      continue;
    }
    if (cs.key.startsWith('themed:')) {
      if (themed >= 1) continue;
      const songs = unclaimed([...new Set(cs.songIds ?? [])].map((id) => pool.get(id)).filter((s): s is SongRecord => !!s));
      if (songs.length < MIN_SHELF) continue;
      themed += 1;
      claim(songs);
      out.push({ key: cs.key.toLowerCase().replace(/[^a-z0-9:-]+/g, '-').slice(0, 60), title: cs.title, reason: cs.reason || 'For this moment', songs: songs.slice(0, SHELF_SIZE) });
      continue;
    }
    const base = byKey.get(cs.key);
    if (!base || used.has(base.key)) continue;
    used.add(base.key);
    const songs = unclaimed(base.songs);
    // A shelf the composer's own themed or merged shelf emptied is left out rather than repeated.
    if (songs.length < MIN_SHELF) continue;
    claim(songs);
    out.push({ key: base.key, title: cs.title, reason: cs.reason || base.reason, songs });
  }
  for (const s of shelves) {
    if (used.has(s.key)) continue;
    const songs = unclaimed(s.songs);
    if (songs.length < MIN_SHELF) continue;
    claim(songs);
    out.push({ ...s, songs });
  }
  return out;
}

export interface ComposeResult { shelves: Shelf[]; greeting: string | null; model: string | null; composed: boolean; ms: number }

/** Shape the page with the model; the deterministic page when it cannot. Never throws. */
export async function composeHome(env: AiEnv, shelves: readonly Shelf[], ctx: ComposeContext, signal?: AbortSignal): Promise<ComposeResult> {
  const started = Date.now();
  const pool = new Map<string, SongRecord>();
  for (const s of shelves) for (const song of s.songs) pool.set(song.id, song);
  if (!shelves.length) return { shelves: [], greeting: null, model: null, composed: false, ms: 0 };
  try {
    const r = await completeJson(env, {
      system: COMPOSE_SYSTEM,
      user: composePrompt(shelves, [...pool.values()], ctx),
      ladder: 'default',
      maxOutputTokens: 1_500,
      temperature: 0.6,
      firstEventMs: COMPOSE_FIRST_EVENT_MS,
      budgetMs: COMPOSE_BUDGET_MS,
      validate: validateComposition,
      signal,
    });
    if (!r) return { shelves: [...shelves], greeting: null, model: null, composed: false, ms: Date.now() - started };
    const applied = applyComposition(r.value, shelves, pool);
    if (applied.length < Math.min(3, shelves.length)) return { shelves: [...shelves], greeting: r.value.greeting, model: r.spec?.id ?? null, composed: false, ms: Date.now() - started };
    return { shelves: applied, greeting: r.value.greeting, model: r.spec?.id ?? null, composed: true, ms: Date.now() - started };
  } catch {
    return { shelves: [...shelves], greeting: null, model: null, composed: false, ms: Date.now() - started };
  }
}
