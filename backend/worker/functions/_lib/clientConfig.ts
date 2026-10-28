/**
 * v5.15.0 — the admin-published config keys that the app itself reads, and
 * the ONE public bundle that ships them (GET /api/appconfig?key=client).
 *
 * Every value is sanitised on the way out, so a bad value can never break
 * listeners: unknown fields are dropped, strings are clipped, lists are capped.
 *
 * 14.0 — values come from the `settings` table (one key, one JSON value,
 * written from the owner console); the vocabulary is SETTING_KEYS in
 * _lib/settings.ts. Besides the client bundle this file sanitises the other
 * public config answers: banners, the festival override, flags and site mode.
 */
import type { ExperimentVariant } from './experiments';

export const CLIENT_KEYS = [
  'home-layout',
  'greeting', 'broadcast', 'search-synonyms', 'catalog-sources', 'language-order',
  'ai-starters', 'ai-quick', 'support-faq', 'min-version', 'maintenance-window',
] as const;

/**
 * 7.2.0 — recommendation weight overrides. Written ONLY by the validated,
 * versioned route api/admin/recconfig.ts (never by the generic appconfig
 * POST, so it is deliberately not in CLIENT_KEYS / ALLOWED_KEYS), read into
 * the public `client` bundle as `recConfig`.
 */
export const REC_CONFIG_KEY = 'rec-config';
export const REC_CONFIG_HISTORY_KEY = 'rec-config-history';
/** Everything the public `client` bundle reads in its one query. */
export const CLIENT_READ_KEYS = [...CLIENT_KEYS, REC_CONFIG_KEY] as const;

/**
 * The scorer's default weights — a mirror of
 * frontend/src/services/recommendation/weights.ts (SCORING_WEIGHTS_VERSION
 * 1.3.0: same values as 1.2.0, and since 9.0 every key is read by the
 * scorer), pinned by __tests__/recConfig.test.ts, which reads that file.
 */
export const REC_WEIGHT_DEFAULTS = {
  mood: 0.16, vibe: 0.1, language: 0.12, dialect: 0.08, genre: 0.1, energy: 0.1, tempo: 0.08,
  artistAffinity: 0.14, history: 0.1, likes: 0.1, skips: 0.12, session: 0.12, discovery: 0.07,
  popularity: 0.05, freshness: 0.04, diversity: 0.2, songAffinity: 0.12, dayOfWeek: 0.04,
  novelty: 0.16, artistFatigue: 0.04, intentArtist: 0.18, intentLanguage: 0.08, intentEnergy: 0.3,
  intentSkippedSong: 0.4,
} as const;
export type RecWeightKey = keyof typeof REC_WEIGHT_DEFAULTS;
export type RecOverrides = Partial<Record<RecWeightKey, number>>;

/** Safe range for every override: half to double its default (same rule on the device). */
export const REC_WEIGHT_MIN_FACTOR = 0.5;
export const REC_WEIGHT_MAX_FACTOR = 2;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function isRecWeightKey(k: string): k is RecWeightKey {
  return Object.prototype.hasOwnProperty.call(REC_WEIGHT_DEFAULTS, k);
}

export function recWeightBounds(key: RecWeightKey): { min: number; max: number } {
  const d = REC_WEIGHT_DEFAULTS[key];
  return { min: round4(d * REC_WEIGHT_MIN_FACTOR), max: round4(d * REC_WEIGHT_MAX_FACTOR) };
}

export function clampRecWeight(key: RecWeightKey, v: number): number {
  const { min, max } = recWeightBounds(key);
  return round4(Math.min(max, Math.max(min, v)));
}

/** Known keys with finite numbers only, each clamped; anything else is dropped. */
export function sanitizeRecOverrides(raw: unknown): RecOverrides {
  const out: RecOverrides = {};
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) {
    if (!isRecWeightKey(k) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[k] = clampRecWeight(k, v);
  }
  return out;
}

export type PublicRecRollout =
  | { mode: 'all' }
  | { mode: 'experiment'; experimentKey: string; variant: string; variants?: ExperimentVariant[] };
export interface PublicRecConfig {
  version: number;
  overrides: RecOverrides;
  rollout: PublicRecRollout;
}
export const EXPERIMENT_KEY_RE = /^[a-z0-9-]{1,40}$/;

/**
 * What listeners' apps receive: version, clamped overrides and who is
 * targeted. Null when nothing should change on any device (rollout off, no
 * valid override, malformed row). Notes, evaluations and authors stay admin-only.
 */
export function publicRecConfig(raw: unknown): PublicRecConfig | null {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r || !Number.isInteger(r.version) || (r.version as number) < 1) return null;
  const overrides = sanitizeRecOverrides(r.overrides);
  if (!Object.keys(overrides).length) return null;
  const ro = r.rollout && typeof r.rollout === 'object' ? (r.rollout as Record<string, unknown>) : null;
  if (ro?.mode === 'all') return { version: r.version as number, overrides, rollout: { mode: 'all' } };
  if (ro?.mode === 'experiment') {
    const experimentKey = typeof ro.experimentKey === 'string' ? ro.experimentKey : '';
    const variant = typeof ro.variant === 'string' ? ro.variant.trim().slice(0, 24) : '';
    if (!EXPERIMENT_KEY_RE.test(experimentKey) || !variant) return null;
    return { version: r.version as number, overrides, rollout: { mode: 'experiment', experimentKey, variant } };
  }
  return null;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// Quick-action prompts keep their trailing space on purpose ("Write a ").
const strRaw = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const inWindow = (start: unknown, end: unknown, now: Date): boolean => {
  const s = typeof start === 'string' && start ? Date.parse(start) : NaN;
  const e = typeof end === 'string' && end ? Date.parse(end) : NaN;
  if (!Number.isNaN(s) && now.getTime() < s) return false;
  if (!Number.isNaN(e) && now.getTime() > e) return false;
  return true;
};
const SLUG = /^[a-z][a-z0-9_-]{0,39}$/;

export interface ClientConfig {
  homeLayout?: { title: string; description: string; order: string[]; hidden: string[] };
  greeting: { text: string } | null;
  broadcast: { id: string; text: string; link?: string } | null;
  synonyms: Record<string, string>;
  disabledSources: string[];
  languageOrder: string[];
  aiStarters: string[];
  aiQuick: Array<{ icon: string; label: string; prompt: string; mode?: string }>;
  faq: Array<{ q: string; a: string }>;
  minBuild: number | null;
  /** 7.2.0 — present only while a weight override targets someone (see publicRecConfig). */
  recConfig?: PublicRecConfig;
}

/** The safe, public shape — what listeners' apps actually receive. */
export function publicClientConfig(raw: Record<string, unknown>, now = new Date()): ClientConfig {
  const g = obj(raw['greeting']);
  const greeting = g && str(g.text, 160) && inWindow(g.start, g.end, now) ? { text: str(g.text, 160) } : null;

  const b = obj(raw['broadcast']);
  const broadcast = b && str(b.id, 40) && str(b.text, 240) && inWindow(b.start, b.end, now)
    ? { id: str(b.id, 40), text: str(b.text, 240), ...(str(b.link, 200).startsWith('/') ? { link: str(b.link, 200) } : {}) }
    : null;

  const synonyms: Record<string, string> = {};
  const syn = obj(raw['search-synonyms']);
  if (syn) {
    for (const [k, v] of Object.entries(syn)) {
      const from = k.trim().toLowerCase().slice(0, 60);
      const to = str(v, 80);
      if (from && to && from !== to.toLowerCase()) synonyms[from] = to;
      if (Object.keys(synonyms).length >= 200) break;
    }
  }

  const cs = obj(raw['catalog-sources']);
  const disabledSources = cs ? Object.entries(cs).filter(([k, v]) => v === false && SLUG.test(k)).map(([k]) => k).slice(0, 20) : [];

  const lo = raw['language-order'];
  const languageOrder = Array.isArray(lo) ? (lo as unknown[]).filter((x): x is string => typeof x === 'string' && SLUG.test(x)).slice(0, 20) : [];

  const st = raw['ai-starters'];
  const aiStarters = Array.isArray(st) ? (st as unknown[]).map((x) => str(x, 160)).filter(Boolean).slice(0, 24) : [];

  const qa = raw['ai-quick'];
  const aiQuick = Array.isArray(qa)
    ? (qa as unknown[]).map(obj).filter((x): x is Record<string, unknown> => !!x)
      .map((x) => ({ icon: str(x.icon, 4), label: str(x.label, 20), prompt: strRaw(x.prompt, 200), ...(SLUG.test(str(x.mode, 20)) ? { mode: str(x.mode, 20) } : {}) }))
      .filter((x) => x.label && x.prompt.trim()).slice(0, 8)
    : [];

  const fq = raw['support-faq'];
  const faq = Array.isArray(fq)
    ? (fq as unknown[]).map(obj).filter((x): x is Record<string, unknown> => !!x)
      .map((x) => ({ q: str(x.q, 160), a: str(x.a, 1200) })).filter((x) => x.q && x.a).slice(0, 30)
    : [];

  const mv = obj(raw['min-version']);
  const minBuild = mv && Number.isInteger(mv.build) && (mv.build as number) > 0 ? (mv.build as number) : null;

  const home = obj(raw['home-layout']);
  const keys = ['quick', 'personal', 'aihome', 'discovery', 'charts', 'seasonal', 'moods', 'genres', 'artists', 'albums', 'daypicks', 'loved', 'feed'];
  const cleanKeys = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && keys.includes(k)))] : [];
  const homeLayout = home ? { title: str(home.title, 60), description: str(home.description, 160), order: cleanKeys(home.order), hidden: cleanKeys(home.hidden).slice(0, 12) } : undefined;
  const recConfig = publicRecConfig(raw[REC_CONFIG_KEY]);
  return { greeting, broadcast, synonyms, disabledSources, languageOrder, aiStarters, aiQuick, faq, minBuild, ...(homeLayout ? { homeLayout } : {}), ...(recConfig ? { recConfig } : {}) };
}

/** Maintenance window: { start, end, note } in ISO; active when now is inside. */
export function maintenanceActive(raw: unknown, now = new Date()): { note: string } | null {
  const m = obj(raw);
  if (!m) return null;
  const s = typeof m.start === 'string' ? Date.parse(m.start) : NaN;
  const e = typeof m.end === 'string' ? Date.parse(m.end) : NaN;
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  const t = now.getTime();
  return t >= s && t <= e ? { note: str(m.note, 200) } : null;
}

/** House rules for the assistant: plain text lines the team appends to the
 *  system prompt (a promo, a correction, a tone note). Clipped hard. */
export function houseRules(raw: unknown): string {
  const s = str(raw, 1200);
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 32 || ch === '\n' || ch === '\t') out += ch;
  }
  return out;
}

// --------------------------------------------------------------- 14.0 — the other public keys

export interface Banner {
  id?: string;
  title?: string;
  subtitle?: string;
  linkType?: string;
  linkId?: string;
  start?: string;
  end?: string;
  img?: string;
}

/** Banners live today (inside their optional start/end dates), at most 10, fields clipped. */
export function activeBanners(value: unknown, now = new Date()): Banner[] {
  if (!Array.isArray(value)) return [];
  const today = now.toISOString().slice(0, 10);
  const out: Banner[] = [];
  for (const raw of value as unknown[]) {
    const b = obj(raw);
    const title = b ? str(b.title, 80) : '';
    if (!b || !title) continue;
    const start = typeof b.start === 'string' && b.start ? b.start.slice(0, 10) : null;
    const end = typeof b.end === 'string' && b.end ? b.end.slice(0, 10) : null;
    if ((start && today < start) || (end && today > end)) continue;
    const banner: Banner = { title };
    const id = str(b.id, 40); if (id) banner.id = id;
    const subtitle = str(b.subtitle, 160); if (subtitle) banner.subtitle = subtitle;
    const linkType = str(b.linkType, 16); if (['song', 'album', 'playlist', 'artist'].includes(linkType)) banner.linkType = linkType;
    const linkId = str(b.linkId, 80); if (linkId && banner.linkType) banner.linkId = linkId;
    const img = str(b.img, 500); if (/^https:\/\//.test(img)) banner.img = img;
    if (start) banner.start = start;
    if (end) banner.end = end;
    out.push(banner);
    if (out.length >= 10) break;
  }
  return out;
}

/** Only boolean flags with sane names leave the server — anything else is dropped rather than shipped to every client. */
export function publicFlags(value: unknown): Record<string, boolean> {
  const o = obj(value);
  if (!o) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(o)) {
    if (/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(k) && typeof v === 'boolean') out[k] = v;
    if (Object.keys(out).length >= 50) break;
  }
  return out;
}

export interface FestivalOverride {
  mode: 'auto' | 'off' | 'force';
  id?: string;
}

/**
 * The festival skin override the app reads: `force` skins the app with the
 * named festival now, `off` suppresses skins, `auto` (or null) keeps the
 * calendar. An optional start/end window bounds a `force`.
 */
export function publicFestival(value: unknown, now = new Date()): FestivalOverride | null {
  const f = obj(value);
  if (!f) return null;
  const mode = str(f.mode, 8);
  if (mode !== 'auto' && mode !== 'off' && mode !== 'force') return null;
  if (!inWindow(f.start, f.end, now)) return null;
  const id = str(f.id, 40).toLowerCase();
  if (mode === 'force' && !SLUG.test(id)) return null;
  return SLUG.test(id) ? { mode, id } : { mode };
}

export interface SiteMode {
  mode: 'live' | 'maintenance';
  note?: string;
}

/**
 * Live unless the owner switched `site-mode` to maintenance or a
 * `maintenance-window` is active right now. The note is what the gate shows.
 */
export function publicSiteMode(values: Record<string, unknown>, now = new Date()): SiteMode {
  const sm = obj(values['site-mode']);
  if (sm && str(sm.mode, 16) === 'maintenance') {
    const note = str(sm.note, 200);
    return note ? { mode: 'maintenance', note } : { mode: 'maintenance' };
  }
  const window = maintenanceActive(values['maintenance-window'], now);
  if (window) return window.note ? { mode: 'maintenance', note: window.note } : { mode: 'maintenance' };
  return { mode: 'live' };
}
