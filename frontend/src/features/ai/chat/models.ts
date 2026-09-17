/**
 * v7.1 — everything the chat knows about engines and models, with no React in
 * it: the pinned seats, the nickname table for the "who answered" chip, and
 * the pure builder behind the single model menu (search, sections, recents,
 * the agent filter). Pure so it can be unit-tested without a DOM.
 */
import type { CatalogGroup, CatalogGroupId, CatalogModel, CatalogPicks, Mode, ModelChoice } from './types';

// Engine picker: six plain-English seats up front — the ones a listener
// actually chooses between — and every other live engine under Advanced, each
// still wearing its owner-chosen name. Ids stay stable for the API.
// v5.21.0 — retuned to the rotated key set: the retired seats are gone (old
// stored picks are remapped server-side), a general all-rounder took the
// reserve seat, and the two seats marked `catalog` open a live list of every
// free model that key serves (fetched from /api/aimodels).
export const MODES: Array<{
  id: Mode;
  label: string;
  hint: string;
  tier: 'core' | 'advanced';
  catalog?: CatalogGroupId;
}> = [
  { id: 'auto', label: 'Auto', hint: 'Picks the best engine for each question', tier: 'core' },
  { id: 'muse', label: 'Balanced', hint: 'Everyday chat · recommended', tier: 'core' },
  { id: 'swift', label: 'Fast', hint: 'Quickest answers · VinaX OAI OSS 20B', tier: 'core' },
  { id: 'sage', label: 'Deep', hint: 'Careful reasoning · VinaX NVD NMTRN SUP', tier: 'core' },
  {
    id: 'win',
    label: 'Creative',
    hint: 'Ideas, lyrics, stories · VinaX NVD NMTRN 3.5 LTNG 30B',
    tier: 'core',
  },
  {
    id: 'translator',
    label: 'Translate',
    hint: 'Translation specialist · 12+ languages',
    tier: 'core',
  },
  // Advanced — the owner's live models under their own names.
  {
    id: 'nova',
    label: 'VinaX NVD NMTRN ULT',
    hint: 'Most powerful · complex questions',
    tier: 'advanced',
  },
  {
    id: 'nano',
    label: 'VinaX NVD NMTRN NN OMNI 30B',
    hint: 'Light and quick · song finder',
    tier: 'advanced',
  },
  {
    id: 'pro',
    label: 'VinaX DP V4 PRO',
    hint: 'Deep analysis · advanced reasoning',
    tier: 'advanced',
  },
  { id: 'flash', label: 'VinaX DP V4 FLASH', hint: 'Rapid generalist', tier: 'advanced' },
  { id: 'mini', label: 'VinaX MST NMTRN', hint: 'Dependable all-rounder', tier: 'advanced' },
  {
    id: 'scholar',
    label: 'VinaX GRQ ALL',
    hint: 'Music knowledge · instant answers',
    tier: 'advanced',
    catalog: 'grq',
  },
  {
    id: 'router',
    label: 'VinaX OPR ALL',
    hint: 'Free model marketplace · pick any engine',
    tier: 'advanced',
    catalog: 'opr',
  },
  { id: 'k3', label: 'VinaX K3', hint: 'Premium agent · heavyweight generalist', tier: 'advanced' },
  {
    id: 'glimmer',
    label: 'VinaX GGL DIF GEM 26B A4B IT',
    hint: 'Visual-creative · moods and themes',
    tier: 'advanced',
  },
  {
    id: 'musegl',
    label: 'VinaX MTA MUSE GMR 30B',
    hint: 'Playful creative sparks',
    tier: 'advanced',
  },
  { id: 'gemma4', label: 'VinaX GGL GEM 4 31B', hint: 'Open generalist', tier: 'advanced' },
  { id: 'laguna', label: 'VinaX PSD LGNA XS 2.1', hint: 'Small and swift', tier: 'advanced' },
  {
    id: 'ising15',
    label: 'VinaX NVD ING CALBTN 1.5 31B',
    hint: 'Rankings and comparisons',
    tier: 'advanced',
  },
];
// Engine ids retired by the 2026-09-09 key rotation. A listener whose stored
// pick names one keeps their nearest living seat instead of silently landing
// on the default (the server maps them too — this just keeps the UI honest
// about which chip is lit).
export const RETIRED_MODE: Record<string, Mode> = {
  omni: 'nano',
  ising135: 'ising15',
  cgt120: 'swift',
  minimax: 'mini',
};
export const CORE_MODES = MODES.filter((m) => m.tier === 'core');
export const ADVANCED_MODES = MODES.filter((m) => m.tier === 'advanced');
// Engine chip on each reply: which engine actually answered (from stream meta) —
// derived from the served model slug so failovers are reported honestly.
// Order matters: specific slugs sit BEFORE the generic llama/vision row.
const ENGINE_NICK: Array<[RegExp, string]> = [
  // v5.4.0 engines (probe-verified pins) — specific slugs sit first so the
  // legacy rows below can never mislabel them.
  [/nemotron-3\.5-lightning/i, 'VinaX NVD NMTRN 3.5 LTNG 30B'],
  [/nemotron-3-super-120b/i, 'VinaX NVD NMTRN SUP'],
  [/deepseek-v4-pro/i, 'VinaX DP V4 PRO'],
  [/deepseek-v4-flash/i, 'VinaX DP V4 FLASH'],
  [/mistral-nemotron/i, 'VinaX MST NMTRN'],
  [/kimi/i, 'VinaX K3'],
  [/diffusiongemma/i, 'VinaX GGL DIF GEM 26B A4B IT'],
  [/muse-glimmer/i, 'VinaX MTA MUSE GMR 30B'],
  [/gemma-4/i, 'VinaX GGL GEM 4 31B'],
  [/laguna/i, 'VinaX PSD LGNA XS 2.1'],
  [/ising-calibration/i, 'VinaX NVD ING CALBTN 1.5 31B'],
  [/nano-omni/i, 'VinaX NVD NMTRN NN OMNI 30B'],
  [/llama-3\.2-90b-vision/i, 'VinaX MTA VSN 90B'],
  [/llama-3\.2-11b-vision/i, 'VinaX MTA VSN 11B'],
  // A marketplace pick keeps its own name: the listener chose that engine by
  // name, so the chip must not relabel it as something else.
  [/:free$/i, 'VinaX OPR ALL'],
  // Retired seats — old stored replies still label cleanly.
  [/minimax/i, 'VinaX AI'],
  // The chip reports the engine that actually answered, keyed off the served
  // slug — so a reply rescued by the ladder never wears the seat's name
  // (nickname != model). The retired rows below keep old stored replies
  // labelling cleanly instead of falling through to the generic catch-all.
  [/gpt-oss-120b/i, 'VinaX AI'],
  [/gpt-oss-20b/i, 'VinaX OAI OSS 20B'],
  // v5.6.2 — legacy catch-rows renamed to the owner nicknames too, so EVERY
  // chip in the app speaks the same names (old stored slugs included).
  [/nemotron-super|nemotron.super/i, 'VinaX NVD NMTRN SUP'],
  [/nemotron-3-ultra|nemotron.ultra/i, 'VinaX NVD NMTRN ULT'],
  [/nemotron-3-nano|diffusiongemma|gemma/i, 'VinaX NVD NMTRN NN OMNI 30B'],
  // Retired slugs from repo history (inkling/qwen/old deepseeks) — generic label.
  [/inkling|qwen|deepseek/i, 'VinaX AI'],
  [/llama-3\.3-70b|llama-3\.1-8b|vision|llama/i, 'VinaX GRQ ALL'],
];
export const nickForModel = (model: string): string => {
  for (const [re, nick] of ENGINE_NICK) if (re.test(model)) return nick;
  return 'VinaX AI';
};

/** A model's own name out of its slug — vendor prefix and routing suffix are
 *  plumbing, not a name. Mirrors catalogLabel() on the server so a saved pick
 *  reads correctly on the chip before the menu has ever been fetched. */
export const slugLabel = (id: string): string =>
  (id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id)
    .replace(/:(free|beta|extended|nitro|floor)$/i, '')
    .trim() || id;

/** The seat that carries each catalogue on the wire. */
export const GROUP_SEAT: Record<CatalogGroupId, Mode> = { grq: 'scholar', opr: 'router' };
const GROUP_IDS: CatalogGroupId[] = ['grq', 'opr'];

export const isMode = (v: unknown): v is Mode => typeof v === 'string' && MODES.some((m) => m.id === v);

/** Which catalogue (if any) a seat opens. */
export const seatGroup = (mode: Mode): CatalogGroupId | null =>
  MODES.find((m) => m.id === mode)?.catalog ?? null;

/** The model to send with a request: only the two catalogue seats carry one,
 *  and only when the listener actually picked a row (otherwise the seat runs
 *  its own default engine). The server re-checks the slug against the live
 *  catalogue, and every other seat ignores it entirely. */
export const catalogModelForSend = (choice: ModelChoice): string | undefined =>
  seatGroup(choice.mode) ? choice.model || undefined : undefined;

/** Stable identity of a choice — option keys, recents de-duplication. */
export const choiceKey = (c: ModelChoice): string => (seatGroup(c.mode) && c.model ? `${c.mode}:${c.model}` : c.mode);

/** A choice with anything meaningless stripped (a model on a pinned seat). */
export const normaliseChoice = (c: ModelChoice): ModelChoice =>
  seatGroup(c.mode) && c.model ? { mode: c.mode, model: c.model } : { mode: c.mode };

/** What the composer chip reads. Derived from the slug, not from the fetched
 *  list, so a pick saved in an earlier session labels correctly without
 *  waiting on a network round-trip. */
export const choiceLabel = (c: ModelChoice): string =>
  seatGroup(c.mode) && c.model ? slugLabel(c.model) : (MODES.find((m) => m.id === c.mode)?.label ?? 'Model');

/** "128K" / "1M" — the context-size badge. Null when the provider reports none. */
export function contextBadge(context: number | null): string | null {
  if (context === null || !Number.isFinite(context) || context <= 0) return null;
  // 128000 is "128K" and so is 131072: round numbers are decimal, the rest
  // are powers of two.
  const unit = context % 1000 !== 0 && context % 1024 === 0 ? 1024 : 1000;
  const k = context / unit;
  if (k >= 1000) {
    const m = k / unit;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(k)}K`;
}

/* ---------- catalogue response ---------- */

/** Shape-tolerant read of GET /api/aimodels. Unknown groups and malformed rows
 *  are dropped; `agent` is true only when the server says exactly `true`. */
export function parseCatalogResponse(body: unknown): CatalogGroup[] {
  const groups = (body as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return [];
  const out: CatalogGroup[] = [];
  for (const raw of groups) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Record<string, unknown>;
    if (g.id !== 'grq' && g.id !== 'opr') continue;
    if (out.some((o) => o.id === g.id)) continue;
    const models: CatalogModel[] = [];
    const seen = new Set<string>();
    for (const rm of Array.isArray(g.models) ? g.models : []) {
      if (!rm || typeof rm !== 'object') continue;
      const m = rm as Record<string, unknown>;
      const id = typeof m.id === 'string' ? m.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push({
        id,
        // Catalogue models are displayed as the server labels them.
        label: typeof m.label === 'string' && m.label.trim() ? m.label.trim() : slugLabel(id),
        context: typeof m.context === 'number' && Number.isFinite(m.context) ? m.context : null,
        agent: m.agent === true,
      });
    }
    out.push({
      id: g.id,
      label: typeof g.label === 'string' && g.label ? g.label : (MODES.find((mm) => mm.catalog === g.id)?.label ?? g.id),
      hint: typeof g.hint === 'string' ? g.hint : '',
      configured: g.configured === true,
      models,
    });
  }
  return out;
}

/* ---------- agent mode ---------- */

/** Every agent-capable model the catalogue serves right now. */
export function agentChoices(groups: CatalogGroup[]): Array<{ choice: ModelChoice; model: CatalogModel }> {
  const out: Array<{ choice: ModelChoice; model: CatalogModel }> = [];
  for (const g of groups)
    for (const m of g.models) if (m.agent) out.push({ choice: { mode: GROUP_SEAT[g.id], model: m.id }, model: m });
  return out;
}

/** The agent model to switch to when Agent mode is turned on while a plain
 *  model is selected: the largest context window first, then the shorter
 *  (un-suffixed, full-size) name, then alphabetical — deterministic. */
export function bestAgentChoice(groups: CatalogGroup[]): ModelChoice | null {
  const all = agentChoices(groups);
  if (!all.length) return null;
  all.sort(
    (a, b) =>
      (b.model.context ?? 0) - (a.model.context ?? 0) ||
      a.model.label.length - b.model.label.length ||
      a.model.label.localeCompare(b.model.label),
  );
  return all[0].choice;
}

export const isAgentChoice = (c: ModelChoice, groups: CatalogGroup[]): boolean =>
  agentChoices(groups).some((a) => choiceKey(a.choice) === choiceKey(c));

/* ---------- the menu ---------- */

export type CatalogState = 'idle' | 'loading' | 'ready' | 'failed';

export interface MenuRow {
  /** Unique within the menu (a recent repeats a row further down). */
  id: string;
  choice: ModelChoice;
  label: string;
  hint: string;
  /** Context size, e.g. "128K". */
  badge: string | null;
  agent: boolean;
  /** Owner-named engines and raw model names read better in mono. */
  mono: boolean;
}
export interface MenuSection {
  id: string;
  title: string;
  rows: MenuRow[];
  /** A quiet line shown instead of (or under) the rows. */
  note: string | null;
  /** The note is a failure the listener can retry. */
  retry: boolean;
}

export const MAX_RECENTS = 5;
export const NOT_AVAILABLE = 'Not available right now';

const matches = (q: string[], ...hay: string[]): boolean => {
  if (!q.length) return true;
  const text = hay.join(' ').toLowerCase();
  return q.every((t) => text.includes(t));
};

const seatRow = (section: string, m: (typeof MODES)[number]): MenuRow => ({
  id: `${section}-${m.id}`,
  choice: { mode: m.id },
  label: m.label,
  hint: m.hint,
  badge: null,
  agent: false,
  mono: m.tier === 'advanced',
});
const modelRow = (section: string, group: CatalogGroupId, m: CatalogModel): MenuRow => ({
  id: `${section}-${group}-${m.id}`,
  choice: { mode: GROUP_SEAT[group], model: m.id },
  label: m.label,
  hint: '',
  badge: contextBadge(m.context),
  agent: m.agent,
  mono: true,
});

/** The whole model menu as data: recents, the recommended seats, the pinned
 *  engines, then EVERY model of each live catalogue. Nothing is invented — an
 *  unconfigured or empty catalogue is one quiet "not available" line. */
export function buildModelMenu(input: {
  groups: CatalogGroup[];
  state: CatalogState;
  query: string;
  agentOnly: boolean;
  recents: ModelChoice[];
}): MenuSection[] {
  const { groups, state, agentOnly, recents } = input;
  const q = input.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const sections: MenuSection[] = [];
  const byId = (id: CatalogGroupId): CatalogGroup | undefined => groups.find((g) => g.id === id);

  if (!q.length && recents.length) {
    const rows: MenuRow[] = [];
    for (const r of recents.slice(0, MAX_RECENTS)) {
      const group = seatGroup(r.mode);
      if (group && r.model) {
        const live = byId(group)?.models.find((m) => m.id === r.model);
        // Once the catalogue is known, a model it no longer serves is dropped.
        if (state === 'ready' && !live) continue;
        if (agentOnly && !live?.agent) continue;
        rows.push(
          live
            ? modelRow('recent', group, live)
            : { ...modelRow('recent', group, { id: r.model, label: slugLabel(r.model), context: null, agent: false }) },
        );
      } else if (!agentOnly) {
        const seat = MODES.find((m) => m.id === r.mode);
        if (seat) rows.push(seatRow('recent', seat));
      }
    }
    if (rows.length) sections.push({ id: 'recent', title: 'Recently used', rows, note: null, retry: false });
  }

  if (!agentOnly) {
    const core = CORE_MODES.filter((m) => matches(q, m.label, m.hint)).map((m) => seatRow('recommended', m));
    if (core.length) sections.push({ id: 'recommended', title: 'Recommended', rows: core, note: null, retry: false });
    const adv = ADVANCED_MODES.filter((m) => matches(q, m.label, m.hint)).map((m) => seatRow('engines', m));
    if (adv.length) sections.push({ id: 'engines', title: 'VinaX engines', rows: adv, note: null, retry: false });
  }

  let anyAgent = false;
  for (const id of GROUP_IDS) {
    const g = byId(id);
    const title = g?.label ?? MODES.find((m) => m.catalog === id)?.label ?? id;
    if (state === 'idle' || state === 'loading') {
      if (!q.length) sections.push({ id, title, rows: [], note: 'Loading the list…', retry: false });
      continue;
    }
    if (state === 'failed' && !g) {
      if (!q.length) sections.push({ id, title, rows: [], note: 'Couldn’t load the list — tap to retry', retry: true });
      continue;
    }
    const models = (g?.models ?? []).filter((m) => (!agentOnly || m.agent) && matches(q, m.label, m.id, title));
    if (models.some((m) => m.agent)) anyAgent = true;
    if (models.length) {
      sections.push({ id, title, rows: models.map((m) => modelRow(id, id, m)), note: null, retry: false });
    } else if (!q.length && !agentOnly) {
      sections.push({ id, title, rows: [], note: NOT_AVAILABLE, retry: false });
    }
  }

  if (agentOnly && !anyAgent && (state === 'ready' || state === 'failed') && !q.length) {
    sections.push({ id: 'no-agent', title: 'Agent models', rows: [], note: 'No agent model is available right now', retry: state === 'failed' });
  }
  if (q.length && !sections.some((s) => s.rows.length)) {
    return [{ id: 'none', title: 'No matches', rows: [], note: `No model matches “${input.query.trim()}”`, retry: false }];
  }
  return sections;
}

/** Newest first, no duplicates, capped. Pure. */
export function pushRecent(list: ModelChoice[], choice: ModelChoice): ModelChoice[] {
  const c = normaliseChoice(choice);
  const key = choiceKey(c);
  return [c, ...list.filter((r) => choiceKey(r) !== key)].slice(0, MAX_RECENTS);
}

/* ---------- persistence ---------- */

export const DEFAULT_MODE_KEY = 'vinax.aiDefaultMode';
export const CATALOG_PICK_KEY = 'vinax.aiCatalogModels';
export const LAST_MODEL_KEY = 'vinax.aiLastModel';
export const RECENT_MODELS_KEY = 'vinax.aiRecentModels';

/** Engine ids saved by much older builds map to their closest successor. */
const LEGACY_MODE: Record<string, Mode> = {
  maverick: 'muse',
  diffusion: 'muse',
  medium: 'muse',
  fast: 'swift',
  deep: 'sage',
  gemma: 'scholar',
};

/** A stored seat id → a living seat, or null when it names nothing we know. */
export function reviveMode(saved: string | null | undefined): Mode | null {
  if (!saved) return null;
  if (isMode(saved)) return saved;
  return LEGACY_MODE[saved] ?? RETIRED_MODE[saved] ?? null;
}

const reviveChoice = (raw: unknown): ModelChoice | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { mode?: unknown; model?: unknown };
  const mode = reviveMode(typeof r.mode === 'string' ? r.mode : null);
  if (!mode) return null;
  const model = typeof r.model === 'string' && r.model.length <= 128 && /^[\w./:-]+$/.test(r.model) ? r.model : undefined;
  return normaliseChoice({ mode, model });
};

const readJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
};
const writeJson = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — preferences are best-effort */
  }
};

export function loadCatalogPicks(): CatalogPicks {
  const raw = readJson(CATALOG_PICK_KEY);
  if (!raw || typeof raw !== 'object') return {};
  const out: CatalogPicks = {};
  for (const id of GROUP_IDS) {
    const v = (raw as Record<string, unknown>)[id];
    if (typeof v === 'string' && v) out[id] = v;
  }
  return out;
}

/** Remember the model chosen inside a catalogue seat, per seat (the shape the
 *  page has always stored). Choosing the seat itself clears its pick. */
export function saveCatalogPick(choice: ModelChoice): void {
  const group = seatGroup(choice.mode);
  if (!group) return;
  const next = loadCatalogPicks();
  if (choice.model) next[group] = choice.model;
  else delete next[group];
  writeJson(CATALOG_PICK_KEY, next);
}

/** The explicit default (Settings → General), if the listener set one. */
export function loadDefaultChoice(): ModelChoice | null {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(DEFAULT_MODE_KEY);
  } catch {
    /* private mode */
  }
  const mode = reviveMode(saved);
  if (!mode) return null;
  const group = seatGroup(mode);
  return normaliseChoice({ mode, model: group ? loadCatalogPicks()[group] : undefined });
}

export function saveDefaultChoice(choice: ModelChoice | null): void {
  try {
    if (choice) localStorage.setItem(DEFAULT_MODE_KEY, choice.mode);
    else localStorage.removeItem(DEFAULT_MODE_KEY);
  } catch {
    /* private mode */
  }
  if (choice) saveCatalogPick(choice);
}

/** Where a visit starts: the explicit default, else the last model used,
 *  else the everyday seat. */
export function loadInitialChoice(): ModelChoice {
  return loadDefaultChoice() ?? reviveChoice(readJson(LAST_MODEL_KEY)) ?? { mode: 'muse' };
}

export function saveLastChoice(choice: ModelChoice): void {
  writeJson(LAST_MODEL_KEY, normaliseChoice(choice));
}

export function loadRecents(): ModelChoice[] {
  const raw = readJson(RECENT_MODELS_KEY);
  if (!Array.isArray(raw)) return [];
  const out: ModelChoice[] = [];
  for (const r of raw) {
    const c = reviveChoice(r);
    if (c && !out.some((o) => choiceKey(o) === choiceKey(c))) out.push(c);
  }
  return out.slice(0, MAX_RECENTS);
}

export function saveRecents(list: ModelChoice[]): void {
  writeJson(RECENT_MODELS_KEY, list.slice(0, MAX_RECENTS));
}
