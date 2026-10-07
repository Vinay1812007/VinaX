/**
 * v7.1 — everything the chat knows about models, with no React in it: the
 * four providers, the pure builder behind the single model menu (search,
 * sections, recents), and how a pick is stored. Pure so it can be
 * unit-tested without a DOM.
 *
 * 10.3 — one key per provider, every free model that key serves, each under
 * its original name. The fixed seats (Maestro, Balanced, Fast, Deep,
 * Creative, Translate and the Advanced list) and the nickname table that
 * relabelled every answer are gone: a pick is Auto, or one exact model.
 */
import type { AiFeatures, MediaKind, MediaModel, ModelChoice, Provider, ProviderId, ProviderModel, ProviderTool } from './types';

/** The four providers, in menu order. */
export const PROVIDER_IDS: readonly ProviderId[] = ['nvidia', 'openrouter', 'groq', 'gemini'];
export const PROVIDER_LABEL: Record<ProviderId, string> = {
  nvidia: 'NVIDIA',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  gemini: 'Gemini',
};

export const isProviderId = (v: unknown): v is ProviderId => typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);

export const AUTO: ModelChoice = { mode: 'auto' };
export const AUTO_LABEL = 'Auto';
export const AUTO_HINT = 'Picks the best model for each question';

/** A model's name out of its slug — vendor prefix and routing suffix are
 *  plumbing, not a name. Only used when no original name is known yet. */
export const slugLabel = (id: string): string =>
  (id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id)
    .replace(/:(free|beta|extended|nitro|floor)$/i, '')
    .trim() || id;

/** Stable identity of a choice — option keys, recents de-duplication. */
export const choiceKey = (c: ModelChoice): string => (c.mode === 'model' ? `${c.provider}:${c.model}` : 'auto');

/** The provider behind a choice (null for Auto). */
export const choiceProvider = (c: ModelChoice | null | undefined): ProviderId | null => (c?.mode === 'model' ? c.provider : null);

/** A live model by provider + slug, if the fetched list has it. */
export const findModel = (providers: readonly Provider[], provider: ProviderId, id: string): ProviderModel | undefined =>
  providers.find((p) => p.id === provider)?.models.find((m) => m.id === id);

/** What the composer chip reads: the live original name when the list is
 *  known, else the name saved with the pick, else the slug. Never waits on
 *  the network. */
export const choiceLabel = (c: ModelChoice, providers: readonly Provider[] = []): string =>
  c.mode === 'model' ? (findModel(providers, c.provider, c.model)?.name ?? c.name ?? slugLabel(c.model)) : AUTO_LABEL;

/** "128K" / "1M" — the context size. Null when the provider reports none. */
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

const SLUG_RE = /^[\w./:@+-]+$/;
const validSlug = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 160 && SLUG_RE.test(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Shape-tolerant read of GET /api/aimodels. Always the four providers in
 *  menu order once the body is readable — a provider the server left out is
 *  "not configured", unknown providers and malformed rows are dropped. A body
 *  with no providers list at all (an older server's `groups`) reads as
 *  nothing, so the menu says the list is unavailable. */
export function parseCatalogResponse(body: unknown): Provider[] {
  const list = (body as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(list)) return [];
  return PROVIDER_IDS.map((id): Provider => {
    const raw = list.find((p): p is Record<string, unknown> => !!p && typeof p === 'object' && (p as { id?: unknown }).id === id);
    const models: ProviderModel[] = [];
    const seen = new Set<string>();
    for (const rm of raw && Array.isArray(raw.models) ? raw.models : []) {
      if (!rm || typeof rm !== 'object') continue;
      const m = rm as Record<string, unknown>;
      const slug = typeof m.id === 'string' ? m.id.trim() : '';
      if (!validSlug(slug) || seen.has(slug)) continue;
      seen.add(slug);
      models.push({
        id: slug,
        name: text(m.name, 120) ?? slugLabel(slug),
        maker: text(m.maker, 60),
        context: typeof m.context === 'number' && Number.isFinite(m.context) && m.context > 0 ? m.context : null,
        vision: m.vision === true,
      });
    }
    return {
      id,
      label: PROVIDER_LABEL[id],
      configured: raw?.configured === true,
      models,
      media: parseMedia(raw?.media),
      tools: parseTools(raw?.tools),
    };
  });
}

/* ---------- 10.3 — media models, tools, features ---------- */

export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'speech', 'transcription', 'music', 'embedding'];
const isMediaKind = (v: unknown): v is MediaKind => typeof v === 'string' && (MEDIA_KINDS as readonly string[]).includes(v);
/** The tool id for running code. */
export const CODE_TOOL = 'code_execution';
/** 11.0 — the web search tool: the Gemini provider's own search grounding on
 *  its 2.5 Flash models, the only web tool VinaX AI uses. No switch — the
 *  server grounds a listener's pick of such a model, and Auto when the
 *  question is about now. */
export const WEB_TOOL = 'web_search';

/** A provider's non-chat models; malformed rows and unknown kinds are dropped. */
function parseMedia(list: unknown): MediaModel[] {
  const out: MediaModel[] = [];
  const seen = new Set<string>();
  for (const rm of Array.isArray(list) ? list : []) {
    if (!rm || typeof rm !== 'object') continue;
    const m = rm as Record<string, unknown>;
    const slug = typeof m.id === 'string' ? m.id.trim() : '';
    if (!validSlug(slug) || !isMediaKind(m.kind) || seen.has(`${m.kind}:${slug}`)) continue;
    seen.add(`${m.kind}:${slug}`);
    const voices = Array.isArray(m.voices)
      ? [...new Set(m.voices.filter((v): v is string => typeof v === 'string' && validSlug(v.trim())).map((v) => v.trim()))].slice(0, 80)
      : [];
    out.push({ id: slug, name: text(m.name, 120) ?? slugLabel(slug), maker: text(m.maker, 60), kind: m.kind, voices });
  }
  return out;
}

/** A provider's tools. Only tools this build knows how to switch on are kept. */
function parseTools(list: unknown): ProviderTool[] {
  const out: ProviderTool[] = [];
  for (const rt of Array.isArray(list) ? list : []) {
    if (!rt || typeof rt !== 'object') continue;
    const t = rt as Record<string, unknown>;
    if ((t.id !== CODE_TOOL && t.id !== WEB_TOOL) || out.some((o) => o.id === t.id)) continue;
    const models = Array.isArray(t.models) ? t.models.filter(validSlug) : [];
    out.push({ id: t.id, name: text(t.name, 60) ?? (t.id === CODE_TOOL ? 'Code execution' : 'Web search'), models });
  }
  return out;
}

export const NO_FEATURES: AiFeatures = { image: false, speech: false, transcription: false, music: false, code: false, web: false };

/** Shape-tolerant read of the top-level `features` of GET /api/aimodels. An
 *  older server sends none: every feature reads as off and nothing new shows. */
export function parseFeatures(body: unknown): AiFeatures {
  const f = (body as { features?: unknown } | null)?.features;
  if (!f || typeof f !== 'object') return NO_FEATURES;
  const r = f as Record<string, unknown>;
  return { image: r.image === true, speech: r.speech === true, transcription: r.transcription === true, music: r.music === true, code: r.code === true, web: r.web === true };
}

/** The chat model can run code (it is in its provider's code tool list). */
export const canRunCode = (providers: readonly Provider[], provider: ProviderId, model: string): boolean =>
  !!providers.find((p) => p.id === provider)?.tools?.some((t) => t.id === CODE_TOOL && t.models.includes(model));
/** 11.0 — the chat model searches the web (it is in its provider's web search tool list). */
export const canSearchWeb = (providers: readonly Provider[], provider: ProviderId, model: string): boolean =>
  !!providers.find((p) => p.id === provider)?.tools?.some((t) => t.id === WEB_TOOL && t.models.includes(model));

/** Every configured provider's models of one kind, in menu order — the
 *  groups of a media picker. Providers with none are left out. */
export function mediaGroups(providers: readonly Provider[], kind: MediaKind): Array<{ provider: ProviderId; label: string; models: MediaModel[] }> {
  const out: Array<{ provider: ProviderId; label: string; models: MediaModel[] }> = [];
  for (const id of PROVIDER_IDS) {
    const p = providers.find((x) => x.id === id);
    const models = p?.configured ? (p.media ?? []).filter((m) => m.kind === kind) : [];
    if (models.length) out.push({ provider: id, label: PROVIDER_LABEL[id], models });
  }
  return out;
}

/* ---------- the menu ---------- */

export type CatalogState = 'idle' | 'loading' | 'ready' | 'failed';

export interface MenuRow {
  /** Unique within the menu (a recent repeats a row further down). */
  id: string;
  choice: ModelChoice;
  label: string;
  /** Quiet secondary line: maker and context size (and provider, on a recent). */
  hint: string;
  /** The model reads images. */
  vision: boolean;
  /** 10.3 — the model can run code (its provider lists it under the code tool). */
  code: boolean;
  /** 11.0 — the model searches the web (its provider lists it under the web search tool). */
  web: boolean;
  /** Logo shown on the row itself — recents only; a provider section has it in its heading. */
  provider: ProviderId | null;
}
export interface MenuSection {
  id: string;
  /** Empty = no visible heading (Auto); the group is then named by `label`. */
  title: string;
  label: string;
  /** Provider sections carry the provider, for the logo in the heading. */
  provider: ProviderId | null;
  rows: MenuRow[];
  /** A quiet line shown instead of (or under) the rows. */
  note: string | null;
  /** The note is a failure the listener can retry. */
  retry: boolean;
}

export const MAX_RECENTS = 5;
/** 10.3 — the tag on a chat model that can run code. */
export const RUNS_CODE = 'Runs code';
/** 11.0 — the tag on a model that searches the web. */
export const SEARCHES_WEB = 'Searches the web';
export const NOT_AVAILABLE = 'Not available right now';

const matches = (q: string[], ...hay: Array<string | null>): boolean => {
  if (!q.length) return true;
  const all = hay.filter(Boolean).join(' ').toLowerCase();
  return q.every((t) => all.includes(t));
};

const modelHint = (m: ProviderModel, withProvider?: ProviderId): string => {
  const ctx = contextBadge(m.context);
  return [withProvider ? PROVIDER_LABEL[withProvider] : null, m.maker, ctx ? `${ctx} context` : null].filter(Boolean).join(' · ');
};
const modelRow = (section: string, provider: ProviderId, m: ProviderModel, recent = false, code = false, web = false): MenuRow => ({
  id: `${section}-${provider}-${m.id}`,
  choice: { mode: 'model', provider, model: m.id, name: m.name },
  label: m.name,
  hint: modelHint(m, recent ? provider : undefined),
  vision: m.vision,
  code,
  web,
  provider: recent ? provider : null,
});
const section = (s: Omit<MenuSection, 'note' | 'retry' | 'provider'> & Partial<MenuSection>): MenuSection => ({
  note: null,
  retry: false,
  provider: null,
  ...s,
});

/** The whole model menu as data: Auto, recently used models, then one
 *  section per provider listing EVERY model it serves. Nothing is invented —
 *  a provider without a key or without a list is one quiet line. */
export function buildModelMenu(input: {
  providers: readonly Provider[];
  state: CatalogState;
  query: string;
  recents: readonly ModelChoice[];
}): MenuSection[] {
  const { providers, state, recents } = input;
  const q = input.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const sections: MenuSection[] = [];
  const byId = (id: ProviderId): Provider | undefined => providers.find((p) => p.id === id);

  if (matches(q, AUTO_LABEL, AUTO_HINT)) {
    sections.push(
      section({
        id: 'auto',
        title: '',
        label: AUTO_LABEL,
        rows: [{ id: 'auto', choice: AUTO, label: AUTO_LABEL, hint: AUTO_HINT, vision: false, code: false, web: false, provider: null }],
      }),
    );
  }

  if (!q.length && recents.length) {
    const rows: MenuRow[] = [];
    for (const r of recents.slice(0, MAX_RECENTS)) {
      if (r.mode !== 'model') continue;
      const live = findModel(providers, r.provider, r.model);
      // Once the list is known, a model the provider no longer serves is dropped.
      if (state === 'ready' && !live) continue;
      rows.push(
        modelRow(
          'recent',
          r.provider,
          live ?? { id: r.model, name: r.name ?? slugLabel(r.model), maker: null, context: null, vision: false },
          true,
          canRunCode(providers, r.provider, r.model),
          canSearchWeb(providers, r.provider, r.model),
        ),
      );
    }
    if (rows.length) sections.push(section({ id: 'recent', title: 'Recently used', label: 'Recently used', rows }));
  }

  for (const id of PROVIDER_IDS) {
    const p = byId(id);
    const title = PROVIDER_LABEL[id];
    const base = { id, title, label: title, provider: id };
    if (state === 'idle' || state === 'loading') {
      if (!q.length) sections.push(section({ ...base, rows: [], note: 'Loading the list…' }));
      continue;
    }
    if (state === 'failed' && !p) {
      if (!q.length) sections.push(section({ ...base, rows: [], note: 'Couldn’t load the list — tap to retry', retry: true }));
      continue;
    }
    // 10.3 — "runs code" finds the models that can run code.
    const models = p?.configured
      ? p.models.filter((m) => matches(q, m.name, m.maker, m.id, title, canRunCode(providers, id, m.id) ? RUNS_CODE : null, canSearchWeb(providers, id, m.id) ? SEARCHES_WEB : null))
      : [];
    if (models.length) {
      sections.push(section({ ...base, rows: models.map((m) => modelRow(id, id, m, false, canRunCode(providers, id, m.id), canSearchWeb(providers, id, m.id))) }));
    } else if (!q.length) {
      sections.push(section({ ...base, rows: [], note: NOT_AVAILABLE }));
    }
  }

  if (q.length && !sections.some((s) => s.rows.length)) {
    return [section({ id: 'none', title: 'No matches', label: 'No matches', rows: [], note: `No model matches “${input.query.trim()}”` })];
  }
  return sections;
}

/** Newest first, no duplicates, capped. Auto is always at the top of the
 *  menu, so it is never a "recent". Pure. */
export function pushRecent(list: readonly ModelChoice[], choice: ModelChoice): ModelChoice[] {
  if (choice.mode !== 'model') return list.slice(0, MAX_RECENTS);
  const key = choiceKey(choice);
  return [choice, ...list.filter((r) => choiceKey(r) !== key)].slice(0, MAX_RECENTS);
}

/* ---------- persistence ---------- */

// The keys predate 10.3; the values are the new shape. A value an older build
// wrote (a seat id such as "muse", or a `scholar`/`router` catalogue pick)
// revives as nothing, is removed, and the visit starts on Auto. The old
// per-catalogue pick key is retired in storage.ts (RETIRED_PREF_KEYS).
export const DEFAULT_MODE_KEY = 'vinax.aiDefaultMode';
export const LAST_MODEL_KEY = 'vinax.aiLastModel';
export const RECENT_MODELS_KEY = 'vinax.aiRecentModels';

/** A stored choice → a valid one, or null when it is an older build's shape. */
export function reviveChoice(raw: unknown): ModelChoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { mode?: unknown; provider?: unknown; model?: unknown; name?: unknown };
  if (r.mode === 'auto') return AUTO;
  if (r.mode !== 'model' || !isProviderId(r.provider) || !validSlug(r.model)) return null;
  const name = text(r.name, 120);
  return name ? { mode: 'model', provider: r.provider, model: r.model, name } : { mode: 'model', provider: r.provider, model: r.model };
}

const readRaw = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const readJson = (key: string): unknown => {
  const raw = readRaw(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};
const writeRaw = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — preferences are best-effort */
  }
};

/** The explicit default (Settings → General), if the listener set one.
 *  Stored as "auto" (the value older builds also wrote for Auto) or as the
 *  JSON of one exact model. */
export function loadDefaultChoice(): ModelChoice | null {
  const raw = readRaw(DEFAULT_MODE_KEY);
  if (!raw) return null;
  if (raw === 'auto') return AUTO;
  let parsed: unknown = null;
  try {
    parsed = raw.startsWith('{') ? (JSON.parse(raw) as unknown) : null;
  } catch {
    /* not ours */
  }
  const c = reviveChoice(parsed);
  // 10.3 — an older build's seat id ("muse", "maestro", …): dropped quietly.
  if (!c) writeRaw(DEFAULT_MODE_KEY, null);
  return c;
}

export function saveDefaultChoice(choice: ModelChoice | null): void {
  writeRaw(DEFAULT_MODE_KEY, !choice ? null : choice.mode === 'auto' ? 'auto' : JSON.stringify(choice));
}

/** Where a visit starts: the explicit default, else the last model used,
 *  else Auto. */
export function loadInitialChoice(): ModelChoice {
  const def = loadDefaultChoice();
  if (def) return def;
  const raw = readJson(LAST_MODEL_KEY);
  const last = reviveChoice(raw);
  // 10.3 — a stale pick (a retired seat or catalogue) migrates to Auto.
  if (!last && raw !== null) writeRaw(LAST_MODEL_KEY, null);
  return last ?? AUTO;
}

/**
 * 11.0 — the server said this pick is no longer on its list: forget it
 * everywhere it is remembered (the default, the last model used, the recents),
 * so the next visit does not start on it again. Returns the recents that remain.
 */
export function forgetChoice(choice: ModelChoice): ModelChoice[] {
  const key = choiceKey(choice);
  const def = loadDefaultChoice();
  if (def && choiceKey(def) === key) saveDefaultChoice(null);
  const last = reviveChoice(readJson(LAST_MODEL_KEY));
  if (last && choiceKey(last) === key) writeRaw(LAST_MODEL_KEY, null);
  const kept = loadRecents().filter((c) => choiceKey(c) !== key);
  saveRecents(kept);
  return kept;
}

export function saveLastChoice(choice: ModelChoice): void {
  writeRaw(LAST_MODEL_KEY, JSON.stringify(choice));
}

export function loadRecents(): ModelChoice[] {
  const raw = readJson(RECENT_MODELS_KEY);
  if (!Array.isArray(raw)) return [];
  const out: ModelChoice[] = [];
  for (const r of raw) {
    const c = reviveChoice(r);
    if (c && c.mode === 'model' && !out.some((o) => choiceKey(o) === choiceKey(c))) out.push(c);
  }
  const kept = out.slice(0, MAX_RECENTS);
  // 10.3 — older builds' seats and catalogue picks fall out of the list.
  if (kept.length !== raw.length) saveRecents(kept);
  return kept;
}

export function saveRecents(list: readonly ModelChoice[]): void {
  writeRaw(RECENT_MODELS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
}
