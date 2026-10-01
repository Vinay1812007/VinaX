/**
 * Admin: Recommendation Tuning (7.2.0) — versioned, bounded weight overrides.
 *
 *   GET  /api/admin/recconfig →
 *     { configured, version, current, live, history, weights, baseVersion,
 *       evalCommand, experiments, experimentsRead }
 *   POST /api/admin/recconfig
 *     { expectedVersion, overrides, rollout, note?, evaluation?, by? }         publish
 *     { action: 'rollback', toVersion, expectedVersion, note?, by? }          rollback
 *     → 200 { ok, record, clamped, historySaved }
 *     → 409 { error: 'version_conflict', version, current }   (nothing written)
 *     → 400 { error: 'invalid', problems } | { error: 'expected_version_required' } | …
 *
 * The record lives in vinax_config under `rec-config`:
 *   { version, overrides, rollout: { mode: 'off'|'experiment'|'all', experimentKey?, variant? },
 *     note, evaluation: null | { summary, url, at }, updatedAt, updatedBy }
 * and the last 20 versions under `rec-config-history` (newest first).
 *
 * Rules:
 *  - Only the weight keys of frontend/src/services/recommendation/weights.ts
 *    (REC_WEIGHT_DEFAULTS in _lib/clientConfig.ts) are accepted; an unknown
 *    key or a non-number rejects the whole request. A value outside half to
 *    double its default is clamped, and the response lists every clamp.
 *  - Concurrency: the POST names the version it was edited from. The write is
 *    a conditional update on that version, so two operators can never
 *    silently overwrite each other; the loser gets 409 and the current record.
 *  - Rollback publishes an older version's overrides and rollout as a NEW
 *    version; history is never rewritten.
 *  - Staged rollout reuses A/B experiments: `experiment` mode targets the
 *    devices whose hash lands in one variant of an existing experiment.
 *  - A record without an evaluation is unvalidated; nothing here claims a
 *    weight change is an improvement.
 *
 * Only the version, the clamped overrides and the rollout reach listeners
 * (see publicRecConfig in _lib/clientConfig.ts); notes, evaluations and
 * authors stay in the console.
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { logAdminAudit } from '../../_lib/adminAudit';
import {
  EXPERIMENT_KEY_RE,
  REC_CONFIG_HISTORY_KEY,
  REC_CONFIG_KEY,
  REC_WEIGHT_DEFAULTS,
  REC_WEIGHT_MAX_FACTOR,
  REC_WEIGHT_MIN_FACTOR,
  clampRecWeight,
  isRecWeightKey,
  recWeightBounds,
  sanitizeRecOverrides,
  type RecOverrides,
  type RecWeightKey,
} from '../../_lib/clientConfig';
import { sanitizeVariants, type ExperimentVariant } from '../../_lib/experiments';
import {
  dbErrorCode,
  dbFailureFromStatus,
  dbFetch,
  sbInsertIgnore,
  sbSelectResult,
  sbUpsert,
  supabaseConfigured,
  type DbFailure,
  type SupabaseEnv,
} from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const HISTORY_LIMIT = 20;
export const BASE_WEIGHTS_VERSION = '1.3.0';
export const EVAL_COMMAND = 'node frontend/scripts/eval-recs.mjs';

export type RolloutMode = 'off' | 'experiment' | 'all';
export interface RecRollout { mode: RolloutMode; experimentKey?: string; variant?: string }
export interface RecEvaluation { summary: string; url: string; at: string }
export interface RecConfigRecord {
  version: number;
  overrides: RecOverrides;
  rollout: RecRollout;
  note: string;
  evaluation: RecEvaluation | null;
  updatedAt: string;
  updatedBy: string;
}

/**
 * What each weight moves in the scorer (scoring.ts / reranking.ts), for the
 * console's scenario preview. "reason: x" is a reason chip listeners can see
 * under "Why this song?"; "silent" terms change the score without a chip.
 */
export const REC_WEIGHT_TERMS: Record<RecWeightKey, { touches: string[]; note?: string }> = {
  mood: { touches: ['reason: mood — mood match with the seed'] },
  vibe: { touches: ['reason: vibe — vibe overlap with the seed', 'silent: listener vibe affinity (× 0.6)'] },
  language: { touches: ['silent: same language as the seed'] },
  dialect: { touches: ['reason: dialect — exact dialect match', 'silent: sub-language (× 0.65) and listener dialect affinity'] },
  genre: { touches: ['reason: genre — genre overlap with the seed', 'silent: listener genre affinity (× 0.6)'] },
  energy: { touches: ['reason: energy — closeness to the seed, to the listener average (× 0.35) and to the usual energy (× 0.3)'] },
  tempo: { touches: ['reason: tempo — closeness to the seed; to the listener average (× 0.35)'] },
  artistAffinity: { touches: ["reason: artist — the listener's affinity for the lead artist (× 0.3 × the personal blend at the default) and the lift for an artist played in the last week"] },
  history: { touches: ['reason: history — subtracted for a recently played song'] },
  likes: { touches: ['reason: likes — added for a liked song'] },
  skips: { touches: ['reason: low-skip — subtracted for a song skipped before'] },
  session: { touches: ['reason: session — energy and language momentum of this sitting (±0.07 / +0.03 at the default, ramping in over five plays)', 'reason: mood — mood continuity with the session window'] },
  discovery: { touches: ['re-rank: discovery floor for explore candidates (× 0.2)'] },
  popularity: { touches: ['reason: popularity — log-scaled play count (× 3)'] },
  freshness: { touches: ['silent: released this year or last'] },
  diversity: { touches: ['re-rank: penalty for repeating an artist, genre or language of the last four picks'] },
  songAffinity: { touches: ['reason: song — a song the listener keeps finishing'] },
  dayOfWeek: { touches: ['reason: day — weekday rhythm'] },
  novelty: { touches: ['reason: discovery / familiar — the novelty swing, signed by the discovery lean'] },
  artistFatigue: { touches: ['reason: fatigue — per recent play of one lead artist beyond two'] },
  intentArtist: { touches: ["reason: intent — this sitting's pull on the lead artist"] },
  intentLanguage: { touches: ["reason: intent — this sitting's pull on the language"] },
  intentEnergy: { touches: ['reason: intent — energy steer learned this sitting'] },
  intentSkippedSong: { touches: ['reason: intent — a song skipped in this sitting'] },
};

export function weightTable(): Array<{ key: RecWeightKey; default: number; min: number; max: number; touches: string[]; note?: string }> {
  return (Object.keys(REC_WEIGHT_DEFAULTS) as RecWeightKey[]).map((key) => ({ key, default: REC_WEIGHT_DEFAULTS[key], ...recWeightBounds(key), ...REC_WEIGHT_TERMS[key] }));
}

// ---- parsing & validation -----------------------------------------------------

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
/** Trimmed, clipped, control characters removed (newlines kept in long text). */
function text(v: unknown, max: number, keepNewlines = false): string {
  if (typeof v !== 'string') return '';
  let out = '';
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    if (c >= 32 || (keepNewlines && ch === '\n')) out += ch;
  }
  return out.trim().slice(0, max);
}
const isoOr = (v: unknown, fallback: string): string => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : fallback);

function parseRollout(v: unknown): RecRollout {
  const o = obj(v);
  if (o?.mode === 'all') return { mode: 'all' };
  if (o?.mode === 'experiment') return { mode: 'experiment', experimentKey: text(o.experimentKey, 40), variant: text(o.variant, 24) };
  return { mode: 'off' };
}

function parseEvaluation(v: unknown): RecEvaluation | null {
  const o = obj(v);
  if (!o) return null;
  const summary = text(o.summary, 600, true);
  if (!summary) return null;
  const url = text(o.url, 300);
  return { summary, url: /^https:\/\//i.test(url) ? url : '', at: isoOr(o.at, '') };
}

/** A stored record, sanitised for display (the console still escapes it). Null when absent or malformed. */
export function parseRecord(raw: unknown): RecConfigRecord | null {
  const o = obj(raw);
  if (!o || !Number.isInteger(o.version) || (o.version as number) < 1) return null;
  return {
    version: o.version as number,
    overrides: sanitizeRecOverrides(o.overrides),
    rollout: parseRollout(o.rollout),
    note: text(o.note, 280, true),
    evaluation: parseEvaluation(o.evaluation),
    updatedAt: isoOr(o.updatedAt, ''),
    updatedBy: text(o.updatedBy, 40) || 'admin',
  };
}

export function parseHistory(raw: unknown): RecConfigRecord[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: RecConfigRecord[] = [];
  for (const item of raw) {
    const r = parseRecord(item);
    if (!r || seen.has(r.version)) continue;
    seen.add(r.version);
    out.push(r);
  }
  return out.sort((a, b) => b.version - a.version).slice(0, HISTORY_LIMIT);
}

export interface ExperimentInfo { key: string; name: string | null; active: boolean; variants: ExperimentVariant[] }
export interface Problem { field: string; problem: string }
export interface Clamp { key: RecWeightKey; requested: number; applied: number }
export type Validated =
  | { ok: true; overrides: RecOverrides; rollout: RecRollout; note: string; evaluation: RecEvaluation | null; clamped: Clamp[] }
  | { ok: false; problems: Problem[] };

/**
 * Validate a publish request. Unknown keys and non-numbers reject the whole
 * request (nothing is silently dropped); an out-of-range number is clamped
 * into its safe range and reported. `experiments` is the experiment list, or
 * null when it could not be read (then an experiment rollout cannot be checked).
 */
export function validateRecConfigInput(body: Record<string, unknown>, experiments: ExperimentInfo[] | null, now = new Date()): Validated {
  const problems: Problem[] = [];
  const overrides: RecOverrides = {};
  const clamped: Clamp[] = [];
  const rawOverrides = body.overrides === undefined || body.overrides === null ? {} : obj(body.overrides);
  if (!rawOverrides) problems.push({ field: 'overrides', problem: 'must be an object of weight → number' });
  else {
    for (const [k, v] of Object.entries(rawOverrides)) {
      if (!isRecWeightKey(k)) { problems.push({ field: `overrides.${k.slice(0, 40)}`, problem: 'unknown weight key' }); continue; }
      if (typeof v !== 'number' || !Number.isFinite(v)) { problems.push({ field: `overrides.${k}`, problem: 'must be a finite number' }); continue; }
      const applied = clampRecWeight(k, v);
      if (applied !== v) clamped.push({ key: k, requested: v, applied });
      overrides[k] = applied;
    }
  }

  const ro = obj(body.rollout);
  const mode = ro?.mode;
  let rollout: RecRollout = { mode: 'off' };
  if (mode !== 'off' && mode !== 'all' && mode !== 'experiment') problems.push({ field: 'rollout.mode', problem: "must be 'off', 'experiment' or 'all'" });
  else if (mode === 'all') rollout = { mode: 'all' };
  else if (mode === 'experiment') {
    const experimentKey = typeof ro?.experimentKey === 'string' ? ro.experimentKey.trim() : '';
    const variant = typeof ro?.variant === 'string' ? ro.variant.trim() : '';
    if (!EXPERIMENT_KEY_RE.test(experimentKey)) problems.push({ field: 'rollout.experimentKey', problem: 'must name an experiment' });
    else if (!experiments) problems.push({ field: 'rollout.experimentKey', problem: 'experiments could not be read; try again' });
    else {
      const exp = experiments.find((e) => e.key === experimentKey);
      if (!exp) problems.push({ field: 'rollout.experimentKey', problem: 'no such experiment' });
      else if (!exp.variants.some((v) => v.name === variant)) problems.push({ field: 'rollout.variant', problem: 'not a variant of that experiment' });
    }
    rollout = { mode: 'experiment', experimentKey, variant };
  }
  if (rollout.mode !== 'off' && !Object.keys(overrides).length && !problems.length) {
    problems.push({ field: 'overrides', problem: 'a rollout needs at least one override (use mode off to publish defaults)' });
  }

  if (body.note !== undefined && typeof body.note !== 'string') problems.push({ field: 'note', problem: 'must be text' });
  const note = text(body.note, 280, true);

  let evaluation: RecEvaluation | null = null;
  if (body.evaluation !== undefined && body.evaluation !== null) {
    const ev = obj(body.evaluation);
    const summary = ev ? text(ev.summary, 600, true) : '';
    const url = ev ? text(ev.url, 300) : '';
    if (!ev || !summary) problems.push({ field: 'evaluation.summary', problem: 'an evaluation needs a summary' });
    else if (url && !/^https:\/\//i.test(url)) problems.push({ field: 'evaluation.url', problem: 'must be an https:// link' });
    else evaluation = { summary, url, at: isoOr(ev.at, now.toISOString()) };
  }

  return problems.length ? { ok: false, problems } : { ok: true, overrides, rollout, note, evaluation, clamped };
}

/** Is this record changing anything on any device right now? */
export function isLive(rec: RecConfigRecord | null, experiments: ExperimentInfo[] | null): boolean {
  if (!rec || !Object.keys(rec.overrides).length) return false;
  if (rec.rollout.mode === 'all') return true;
  if (rec.rollout.mode !== 'experiment' || !experiments) return false;
  const exp = experiments.find((e) => e.key === rec.rollout.experimentKey);
  return !!exp && exp.active && exp.variants.some((v) => v.name === rec.rollout.variant);
}

// ---- storage --------------------------------------------------------------------

interface ConfigRow { key: string; value: unknown; updated_at: string | null }

interface Stored { current: RecConfigRecord | null; currentRow: ConfigRow | null; history: RecConfigRecord[] }

async function readStored(env: Env): Promise<{ ok: true; stored: Stored } | { ok: false; error: DbFailure }> {
  const read = await sbSelectResult<ConfigRow>(env, 'vinax_config', `key=in.(${encodeURIComponent(`"${REC_CONFIG_KEY}","${REC_CONFIG_HISTORY_KEY}"`)})&select=key,value,updated_at`);
  if (!read.ok) return { ok: false, error: read.error };
  const currentRow = read.rows.find((r) => r.key === REC_CONFIG_KEY) ?? null;
  const historyRow = read.rows.find((r) => r.key === REC_CONFIG_HISTORY_KEY) ?? null;
  return { ok: true, stored: { current: parseRecord(currentRow?.value), currentRow, history: parseHistory(historyRow?.value) } };
}

async function readExperiments(env: Env): Promise<ExperimentInfo[] | null> {
  const read = await sbSelectResult<{ key: string; name: string | null; active: boolean | null; variants: unknown }>(env, 'vinax_experiments', 'select=key,name,active,variants&order=created_at.desc.nullslast&limit=50');
  if (!read.ok) return null;
  return read.rows.map((r) => ({ key: r.key, name: r.name ?? null, active: r.active === true, variants: sanitizeVariants(r.variants) }));
}

/** PATCH that returns the updated rows, so a conditional update can tell "matched" from "someone got there first". */
async function patchReturning(env: Env, table: string, query: string, patch: unknown): Promise<{ ok: true; rows: unknown[] } | { ok: false; error: DbFailure }> {
  if (!supabaseConfigured(env)) return { ok: false, error: 'not_configured' };
  const base = (env.SUPABASE_URL as string).replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY as string;
  try {
    const res = await dbFetch(`${base}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return { ok: false, error: dbFailureFromStatus(res.status) };
    const body = (await res.json().catch(() => null)) as unknown;
    return Array.isArray(body) ? { ok: true, rows: body } : { ok: false, error: 'unavailable' };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/**
 * Write `next` only if the stored record is still the one the operator
 * edited: insert-if-absent for the first version, otherwise an UPDATE whose
 * filter names the stored version. Zero rows back = someone else won.
 */
async function conditionalWrite(env: Env, stored: Stored, next: RecConfigRecord): Promise<'ok' | 'conflict' | DbFailure> {
  const row = { key: REC_CONFIG_KEY, value: next, updated_at: next.updatedAt };
  if (!stored.currentRow) {
    const ins = await sbInsertIgnore<ConfigRow>(env, 'vinax_config', row, 'key');
    if (ins === null) return 'unavailable';
    return ins.length ? 'ok' : 'conflict';
  }
  const guard = stored.current
    ? `value->>version=eq.${stored.current.version}`
    : stored.currentRow.updated_at
      ? `updated_at=eq.${encodeURIComponent(stored.currentRow.updated_at)}`
      : 'updated_at=is.null';
  const res = await patchReturning(env, 'vinax_config', `key=eq.${encodeURIComponent(REC_CONFIG_KEY)}&${guard}`, { value: next, updated_at: next.updatedAt });
  if (!res.ok) return res.error;
  return res.rows.length ? 'ok' : 'conflict';
}

const summaryLine = (r: RecConfigRecord): string => {
  const target = r.rollout.mode === 'experiment' ? `experiment ${r.rollout.experimentKey}=${r.rollout.variant}` : r.rollout.mode;
  return `v${r.version} · ${target} · ${Object.keys(r.overrides).length} override(s) · ${r.evaluation ? 'evaluation attached' : 'unvalidated'}`;
};

// ---- handlers -------------------------------------------------------------------

export const onRequestGet = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false });
  const [read, experiments] = await Promise.all([readStored(env), readExperiments(env)]);
  if (!read.ok) return json({ configured: true, error: dbErrorCode(read.error) }, 502);
  const { current, history } = read.stored;
  return json({
    configured: true,
    version: current?.version ?? 0,
    current,
    live: isLive(current, experiments),
    history,
    weights: weightTable(),
    range: { minFactor: REC_WEIGHT_MIN_FACTOR, maxFactor: REC_WEIGHT_MAX_FACTOR },
    baseVersion: BASE_WEIGHTS_VERSION,
    evalCommand: EVAL_COMMAND,
    experiments: experiments ?? [],
    experimentsRead: experiments ? 'ok' : 'failed',
  });
};

export const onRequestPost = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) return json({ error: 'not_configured' }, 503);
  const body = obj(await request.json().catch(() => null));
  if (!body) return json({ error: 'bad_request' }, 400);
  const expectedVersion = body.expectedVersion;
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 0) return json({ error: 'expected_version_required' }, 400);

  const read = await readStored(env);
  if (!read.ok) return json({ error: dbErrorCode(read.error) }, 502);
  const { stored } = read;
  const currentVersion = stored.current?.version ?? 0;
  if (expectedVersion !== currentVersion) return json({ error: 'version_conflict', version: currentVersion, current: stored.current }, 409);

  // Rollback = the chosen version's overrides and rollout, published as a new version.
  let input: Record<string, unknown> = body;
  let rolledBackFrom: number | null = null;
  if (body.action === 'rollback') {
    const to = body.toVersion;
    const source = Number.isInteger(to) ? [stored.current, ...stored.history].find((r) => r && r.version === to) : null;
    if (!source) return json({ error: 'version_not_found' }, 404);
    rolledBackFrom = source.version;
    const extra = text(body.note, 200, true);
    input = { overrides: source.overrides, rollout: source.rollout, evaluation: source.evaluation, note: `Rollback to v${source.version}${extra ? ` — ${extra}` : ''}` };
  } else if (body.action !== undefined && body.action !== 'publish') {
    return json({ error: 'unknown_action' }, 400);
  }

  const experiments = obj(input.rollout)?.mode === 'experiment' ? await readExperiments(env) : [];
  const v = validateRecConfigInput(input, experiments);
  if (!v.ok) return json({ error: 'invalid', problems: v.problems }, 400);

  const now = new Date().toISOString();
  const next: RecConfigRecord = {
    version: currentVersion + 1,
    overrides: v.overrides,
    rollout: v.rollout,
    note: v.note,
    evaluation: v.evaluation,
    updatedAt: now,
    updatedBy: text(body.by, 40) || 'admin',
  };
  const wrote = await conditionalWrite(env, stored, next);
  if (wrote === 'conflict') {
    const again = await readStored(env);
    const current = again.ok ? again.stored.current : null;
    return json({ error: 'version_conflict', version: current?.version ?? null, current }, 409);
  }
  if (wrote !== 'ok') return json({ error: dbErrorCode(wrote) }, 502);

  // History is best effort: the record above is already the source of truth.
  const history = [next, ...stored.history.filter((r) => r.version !== next.version)].slice(0, HISTORY_LIMIT);
  const historySaved = await sbUpsert(env, 'vinax_config', { key: REC_CONFIG_HISTORY_KEY, value: history, updated_at: now }, 'key');
  await logAdminAudit(context, {
    action: 'rec-config',
    summary: `${summaryLine(next)}${rolledBackFrom ? ` · rollback of v${rolledBackFrom}` : ''}`,
    target: `v${next.version}`,
    before: stored.current,
    after: next,
  });
  return json({ ok: true, record: next, clamped: v.clamped, historySaved });
};
