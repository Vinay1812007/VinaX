import { isNativePlatform } from '@/services/native';

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/home' : '/api/home';

export interface AiSection {
  title: string;
  query: string;
}

/**
 * Cross-visit anti-repeat memory for AI-designed home shelves (v3.7.1).
 *
 * Without this, the server's varietySeed alone let the taste snapshot dominate
 * the prompt — consecutive Home builds landed on the same top-of-mind shelves
 * ("Trending in Telugu", "A.R. Rahman deep cuts", …). We remember the last N
 * shelves the client actually rendered and hand them to the server as an
 * avoidShelves list; the server both prompts the model against them AND
 * structurally filters them from the response.
 */
const SHOWN_KEY = 'vinax.home.shown.v1';
const SHOWN_CAP = 30;

interface StoredShelf {
  title: string;
  query: string;
  at: number;
}

function loadShown(): StoredShelf[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SHOWN_KEY) || '[]') as unknown;
    return Array.isArray(raw)
      ? (raw as StoredShelf[])
          .filter(
            (s) => s && typeof (s as StoredShelf).title === 'string' && typeof (s as StoredShelf).query === 'string',
          )
          .slice(0, SHOWN_CAP)
      : [];
  } catch {
    return [];
  }
}

/** Merge newly-shown shelves in (newest first), dedupe by title, cap at SHOWN_CAP. */
export function recordShown(sections: AiSection[]): void {
  if (!sections.length) return;
  try {
    const now = Date.now();
    const merged: StoredShelf[] = [
      ...sections.map((s) => ({ title: s.title, query: s.query, at: now })),
      ...loadShown(),
    ];
    const seen = new Set<string>();
    const dedup: StoredShelf[] = [];
    for (const s of merged) {
      const k = s.title.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      dedup.push(s);
    }
    window.localStorage.setItem(SHOWN_KEY, JSON.stringify(dedup.slice(0, SHOWN_CAP)));
  } catch {
    /* ignore */
  }
}

/** Ask the AI for personalized home sections. Returns [] on any failure or when
 *  the AI isn't configured, so Home falls back to its normal shelves. */
export async function getAiHomeSections(context: Record<string, unknown>): Promise<AiSection[]> {
  let res: Response;
  const avoidShelves = loadShown().map((s) => ({ title: s.title, query: s.query }));
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vinax-client': isNativePlatform() ? 'app' : 'web' },
      body: JSON.stringify({ context, avoidShelves }),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as { sections?: AiSection[] } | null;
  const sections = Array.isArray(data?.sections)
    ? data.sections.filter((s) => s && typeof s.title === 'string' && typeof s.query === 'string').slice(0, 6)
    : [];
  // Record what the listener will actually see so the NEXT build steers around it.
  if (sections.length) recordShown(sections);
  return sections;
}

/* ------------------------------------------------------------------ */
/* v5.5.3 — the deterministic shelf designer.                          */
/*                                                                     */
/* The owner-reported failure: when the AI engine was unreachable (a   */
/* flaky lane, a timeout), getAiHomeSections returned [] and Home fell */
/* back to the SAME static shelves every single open. Variety lived or */
/* died with the AI. Now a local designer composes shelves from a      */
/* mood x time-of-day x era x artist template library, seeded by the   */
/* per-visit nonce and steered away from the last 30 shelves shown —   */
/* so every open is different BY CONSTRUCTION, with or without the AI. */
/* The AI, when reachable, still designs the lead shelves; the local   */
/* designer tops the build up to six.                                  */
/* ------------------------------------------------------------------ */

interface DesignCtx {
  topArtists?: string[];
  topLanguages?: string[];
  preferredLanguages?: string[];
  freshnessSeed?: number;
}

/** Tiny seeded RNG — same nonce, same build; new visit, new shuffle. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cap(w: string): string {
  return w ? w[0].toUpperCase() + w.slice(1) : w;
}

type Slot = 'morning' | 'afternoon' | 'evening' | 'night';

function slotNow(d: Date): Slot {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

interface Template {
  /** Only offered during these slots (omit = any time). */
  when?: Slot[];
  /** Only offered on these weekdays, 0=Sunday (omit = any day). */
  days?: number[];
  /** true = an artist shelf (capped at two per build). */
  artist?: boolean;
  make: (lang: string, artist: string) => AiSection;
}

/** The mood/time/era shelf library. Queries are catalog searches; titles are
 *  what the listener reads — keep them warm, short and human. */
const TEMPLATES: Template[] = [
  // Time of day
  { when: ['morning'], make: (l) => ({ title: 'Rise and shine', query: `${l} morning fresh songs` }) },
  { when: ['morning'], make: (l) => ({ title: 'Devotional start', query: `${l} devotional songs` }) },
  { when: ['afternoon'], make: (l) => ({ title: 'Midday boost', query: `${l} upbeat hit songs` }) },
  { when: ['evening'], make: (l) => ({ title: 'Evening melodies', query: `${l} evening melody songs` }) },
  { when: ['evening'], make: (l) => ({ title: 'Golden hour', query: `${l} soulful hits` }) },
  { when: ['night'], make: (l) => ({ title: 'Late night feels', query: `${l} chill night songs` }) },
  { when: ['night'], make: (l) => ({ title: 'Midnight melodies', query: `${l} soft melody songs` }) },
  // Day of week
  { days: [1], make: (l) => ({ title: 'Monday motivation', query: `${l} motivational songs` }) },
  { days: [5, 6], make: (l) => ({ title: 'Weekend party', query: `${l} party dance hits` }) },
  { days: [0], make: (l) => ({ title: 'Sunday slow-down', query: `${l} soothing melody songs` }) },
  // Moods
  { make: (l) => ({ title: 'Love is in the air', query: `${l} romantic hit songs` }) },
  { make: (l) => ({ title: 'In your feels', query: `${l} sad emotional songs` }) },
  { make: (l) => ({ title: 'Mass mode', query: `${l} mass beat songs` }) },
  { make: (l) => ({ title: 'Dance floor', query: `${l} dance hits` }) },
  { make: (l) => ({ title: 'Pure melody', query: `${l} melody hit songs` }) },
  { make: (l) => ({ title: 'Workout fuel', query: `${l} gym workout songs` }) },
  { make: (l) => ({ title: 'On the road', query: `${l} travel driving songs` }) },
  { make: (l) => ({ title: 'Folk and roots', query: `${l} folk hit songs` }) },
  { make: (l) => ({ title: 'Festival vibes', query: `${l} festival celebration songs` }) },
  // Eras
  { make: (l) => ({ title: '90s gold', query: `${l} 90s hit songs` }) },
  { make: (l) => ({ title: '2000s rewind', query: `${l} 2000s hit songs` }) },
  { make: (l) => ({ title: 'Throwback 2010s', query: `${l} 2010s hit songs` }) },
  { make: (l) => ({ title: 'Fresh drops', query: `new ${l} songs` }) },
  // Artists (built from the listener's own top artists)
  { artist: true, make: (l, a) => ({ title: `Best of ${a}`, query: `${a} ${l} best songs` }) },
  { artist: true, make: (l, a) => ({ title: `${a} deep cuts`, query: `${a} ${l} songs` }) },
];

/**
 * Compose `count` shelves locally: seeded shuffle over the applicable
 * templates, languages rotated across shelves, recently-shown titles skipped,
 * at most two artist shelves. Deterministic for a given seed — and a new seed
 * arrives with every Home open.
 */
export function designLocalSections(ctx: DesignCtx, count: number, avoidTitles: Set<string>): AiSection[] {
  if (count <= 0) return [];
  const langs = (ctx.preferredLanguages?.length ? ctx.preferredLanguages : ctx.topLanguages) ?? [];
  if (!langs.length) return [];
  const artists = (ctx.topArtists ?? []).filter(Boolean).slice(0, 6);
  const rng = mulberry32((ctx.freshnessSeed ?? Date.now()) % 2147483647);
  const now = new Date();
  const slot = slotNow(now);
  const day = now.getDay();

  const applicable = TEMPLATES.filter(
    (t) => (!t.when || t.when.includes(slot)) && (!t.days || t.days.includes(day)) && (!t.artist || artists.length > 0),
  );
  // Seeded shuffle — the same library reads differently every visit.
  const shuffled = [...applicable];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const pick = (skipShown: boolean): AiSection[] => {
    const out: AiSection[] = [];
    const used = new Set<string>();
    let artistShelves = 0;
    let li = Math.floor(rng() * langs.length);
    let ai = Math.floor(rng() * Math.max(artists.length, 1));
    for (const t of shuffled) {
      if (out.length >= count) break;
      if (t.artist && artistShelves >= 2) continue;
      const lang = langs[li % langs.length];
      const artist = artists.length ? artists[ai % artists.length] : '';
      const sec = t.make(lang, cap(artist));
      const k = sec.title.trim().toLowerCase();
      if (used.has(k)) continue;
      if (skipShown && avoidTitles.has(k)) continue;
      used.add(k);
      out.push(sec);
      li += 1;
      if (t.artist) {
        artistShelves += 1;
        ai += 1;
      }
    }
    return out;
  };

  const fresh = pick(true);
  // Library exhausted by the avoid-list (tiny catalogs, single language) —
  // repeating an old shelf beats an empty Home.
  return fresh.length >= Math.min(count, 3) ? fresh : pick(false);
}

/**
 * The one entry point Home uses (v5.5.3): AI-designed shelves when the engine
 * answers, topped up to six by the local designer — and a full local build
 * when the AI is down. Every path records what was shown, so the next visit
 * steers elsewhere. Practically never returns [].
 */
export async function getHomeSections(context: Record<string, unknown>): Promise<AiSection[]> {
  const ai = await getAiHomeSections(context); // records its own shelves
  if (ai.length >= 6) return ai.slice(0, 6);
  const avoid = new Set<string>([
    ...loadShown().map((s) => s.title.trim().toLowerCase()),
    ...ai.map((s) => s.title.trim().toLowerCase()),
  ]);
  const local = designLocalSections(context as DesignCtx, 6 - ai.length, avoid);
  if (local.length) recordShown(local);
  return [...ai, ...local];
}
