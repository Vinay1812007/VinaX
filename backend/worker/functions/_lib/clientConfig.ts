/**
 * v5.15.0 — the admin-published config keys that the app itself reads, and
 * the ONE public bundle that ships them (GET /api/appconfig?key=client).
 *
 * Every value here is written by the admin console into `vinax_config` and
 * sanitised again on the way out, so a bad row can never break listeners:
 * unknown fields are dropped, strings are clipped, lists are capped.
 */
import { sbSelect, supabaseConfigured, type SupabaseEnv } from './supabase';
import { sanitizeVariants, type ExperimentVariant } from './experiments';

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
 * 1.2.0), pinned by __tests__/recConfig.test.ts, which reads that file.
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

const splitMemo = new Map<string, { at: number; variants: ExperimentVariant[] }>();

/**
 * An experiment-targeted config ships with that experiment's live split, so
 * a device decides membership with the same pure hash as useExperiment()
 * and needs no second request. A paused or missing experiment targets
 * nobody: the config is withheld. Memoised per isolate like readConfig.
 */
export async function withRolloutSplit(env: SupabaseEnv, cfg: PublicRecConfig | null): Promise<PublicRecConfig | null> {
  if (!cfg || cfg.rollout.mode !== 'experiment') return cfg;
  const key = cfg.rollout.experimentKey;
  let hit = splitMemo.get(key);
  if (!hit || Date.now() - hit.at >= TTL) {
    const rows = await sbSelect<{ variants: unknown }>(env, 'vinax_experiments', `key=eq.${encodeURIComponent(key)}&active=eq.true&select=variants&limit=1`).catch(() => [] as Array<{ variants: unknown }>);
    hit = { at: Date.now(), variants: sanitizeVariants(rows[0]?.variants) };
    splitMemo.set(key, hit);
  }
  const variant = cfg.rollout.variant;
  if (!hit.variants.some((v) => v.name === variant)) return null;
  return { ...cfg, rollout: { ...cfg.rollout, variants: hit.variants } };
}

interface ConfigRow { key: string; value: unknown }

const memo = new Map<string, { at: number; value: Record<string, unknown> }>();
const TTL = 60_000;

/** Read several config keys in one query, memoised per isolate for a minute. */
export async function readConfig(env: SupabaseEnv, keys: readonly string[]): Promise<Record<string, unknown>> {
  if (!supabaseConfigured(env)) return {};
  const id = keys.join(',');
  const hit = memo.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const list = keys.map((k) => `"${k}"`).join(',');
  const rows = await sbSelect<ConfigRow>(env, 'vinax_config', `key=in.(${encodeURIComponent(list)})&select=key,value`).catch(() => [] as ConfigRow[]);
  const value: Record<string, unknown> = {};
  for (const r of rows) value[r.key] = r.value;
  memo.set(id, { at: Date.now(), value });
  return value;
}

/** Test hook. */
export function resetConfigMemo(): void { memo.clear(); splitMemo.clear(); }

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
