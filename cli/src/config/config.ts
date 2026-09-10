/**
 * Configuration resolution, and the privilege rule that goes with it.
 *
 * Precedence, most important first:
 *
 *   1. CLI flags            the user, right now
 *   2. safe environment     VINAX_API_BASE, NO_COLOR, CI …
 *   3. user config          ~/.vinax/config.json — the user's own machine
 *   4. project config       .vinax/config.json — checked into a REPOSITORY
 *   5. defaults
 *
 * Project config is last for a reason. Cloning a repository must never hand
 * that repository power over the machine that cloned it. A project file
 * asking for `"approval": "full-auto"` is asking a stranger's laptop to run
 * whatever the agent decides without confirmation, and the answer is no.
 *
 * The rule: a project may make VinaX STRICTER, never looser. Tighten the
 * approval mode, turn web search off, lower the step ceiling, shrink command
 * timeouts — all honoured. Loosen any of them — ignored, and the user is told
 * it was ignored rather than being left to assume it applied.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApprovalMode } from './args.js';
import { paths } from './paths.js';

export interface VinaxConfig {
  apiBase: string;
  engine: string;
  model: string | null;
  approval: ApprovalMode;
  web: boolean;
  maxSteps: number;
  maxToolCalls: number;
  commandTimeoutMs: number;
  maxOutputChars: number;
  maxFileBytes: number;
  maxPatchChars: number;
  useGitignore: boolean;
  color: boolean | null;
  debug: boolean;
}

export const DEFAULT_API_BASE = 'https://www.sirimillavinay.online';

export const DEFAULTS: VinaxConfig = {
  apiBase: DEFAULT_API_BASE,
  engine: 'auto',
  model: null,
  approval: 'ask',
  web: false,
  maxSteps: 60,
  maxToolCalls: 200,
  commandTimeoutMs: 120_000,
  maxOutputChars: 60_000,
  maxFileBytes: 1_500_000,
  maxPatchChars: 200_000,
  useGitignore: true,
  color: null,
  debug: false,
};

/** Approval modes ordered from strictest to most permissive. */
const APPROVAL_RANK: Record<ApprovalMode, number> = { ask: 0, 'auto-edit': 1, 'full-auto': 2 };

export interface ConfigNote {
  level: 'info' | 'warn';
  message: string;
}

export interface ResolvedConfig {
  config: VinaxConfig;
  /** Anything the user should know about how this config was arrived at. */
  notes: ConfigNote[];
  /** Which sources actually contributed, for `vinax doctor`. */
  sources: string[];
}

type Raw = Partial<Record<keyof VinaxConfig, unknown>>;

async function readJson(file: string): Promise<Raw | null> {
  try {
    const text = await readFile(file, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Raw;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const int = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
};

function applyTrusted(target: VinaxConfig, raw: Raw): void {
  const approval = str(raw.approval);
  if (approval && approval in APPROVAL_RANK) target.approval = approval as ApprovalMode;
  const engine = str(raw.engine);
  if (engine) target.engine = engine;
  if ('model' in raw) target.model = str(raw.model);
  const web = bool(raw.web);
  if (web !== null) target.web = web;
  const apiBase = str(raw.apiBase);
  if (apiBase) target.apiBase = apiBase.replace(/\/+$/, '');
  const maxSteps = int(raw.maxSteps, 1, 500);
  if (maxSteps !== null) target.maxSteps = maxSteps;
  const maxToolCalls = int(raw.maxToolCalls, 1, 5000);
  if (maxToolCalls !== null) target.maxToolCalls = maxToolCalls;
  const timeout = int(raw.commandTimeoutMs, 1000, 900_000);
  if (timeout !== null) target.commandTimeoutMs = timeout;
  const outChars = int(raw.maxOutputChars, 1000, 500_000);
  if (outChars !== null) target.maxOutputChars = outChars;
  const fileBytes = int(raw.maxFileBytes, 1024, 50_000_000);
  if (fileBytes !== null) target.maxFileBytes = fileBytes;
  const patch = int(raw.maxPatchChars, 100, 2_000_000);
  if (patch !== null) target.maxPatchChars = patch;
  const gi = bool(raw.useGitignore);
  if (gi !== null) target.useGitignore = gi;
}

/**
 * Apply a project config, keeping only what makes VinaX stricter.
 *
 * Returns the notes describing anything that was refused — the user sees them
 * on startup, because silently ignoring a setting is its own kind of lie.
 */
export function applyProjectConfig(target: VinaxConfig, raw: Raw): ConfigNote[] {
  const notes: ConfigNote[] = [];

  const approval = str(raw.approval);
  if (approval) {
    if (!(approval in APPROVAL_RANK)) {
      notes.push({ level: 'warn', message: `project config: "${approval}" is not an approval mode — ignored` });
    } else if (APPROVAL_RANK[approval as ApprovalMode] < APPROVAL_RANK[target.approval]) {
      target.approval = approval as ApprovalMode;
      notes.push({ level: 'info', message: `project config tightened the approval mode to ${approval}` });
    } else if (APPROVAL_RANK[approval as ApprovalMode] > APPROVAL_RANK[target.approval]) {
      notes.push({
        level: 'warn',
        message: `project config asked for approval "${approval}", which is more permissive than your "${target.approval}" — ignored. A repository cannot widen VinaX's access to your machine.`,
      });
    }
  }

  const web = bool(raw.web);
  if (web === false && target.web) {
    target.web = false;
    notes.push({ level: 'info', message: 'project config switched web search off' });
  } else if (web === true && !target.web) {
    notes.push({ level: 'warn', message: 'project config asked to switch web search on — ignored; use --web if you want it' });
  }

  // Numbers: a project may only lower a ceiling.
  const lower = (key: 'maxSteps' | 'maxToolCalls' | 'commandTimeoutMs' | 'maxOutputChars' | 'maxFileBytes' | 'maxPatchChars', min: number, max: number): void => {
    const v = int(raw[key], min, max);
    if (v === null) return;
    if (v < target[key]) {
      target[key] = v;
      notes.push({ level: 'info', message: `project config lowered ${key} to ${v}` });
    } else if (v > target[key]) {
      notes.push({ level: 'warn', message: `project config asked to raise ${key} to ${v} — ignored` });
    }
  };
  lower('maxSteps', 1, 500);
  lower('maxToolCalls', 1, 5000);
  lower('commandTimeoutMs', 1000, 900_000);
  lower('maxOutputChars', 1000, 500_000);
  lower('maxFileBytes', 1024, 50_000_000);
  lower('maxPatchChars', 100, 2_000_000);

  // Engine and model are preferences, not privileges: a project may express
  // one, and it cannot do any harm.
  const engine = str(raw.engine);
  if (engine) target.engine = engine;
  if ('model' in raw) target.model = str(raw.model);

  const gi = bool(raw.useGitignore);
  if (gi === true && !target.useGitignore) {
    target.useGitignore = true;
    notes.push({ level: 'info', message: 'project config re-enabled .gitignore filtering' });
  } else if (gi === false) {
    notes.push({ level: 'warn', message: 'project config asked to ignore .gitignore — ignored' });
  }

  // An apiBase in a repository would redirect a developer's agent traffic to
  // a host of the repository author's choosing. Never.
  if (str(raw.apiBase)) {
    notes.push({
      level: 'warn',
      message: 'project config tried to set apiBase — ignored. Only you can change which service VinaX CLI talks to.',
    });
  }
  return notes;
}

export interface ResolveOptions {
  /** Workspace root, where a project config would live. */
  root: string;
  env?: NodeJS.ProcessEnv;
  /** Values from CLI flags — highest precedence, no restrictions. */
  flags?: Partial<VinaxConfig>;
  /** Test seam: skip reading the user's real config file. */
  userConfigFile?: string | null;
}

/** Resolve the effective configuration for one run. */
export async function resolveConfig(opts: ResolveOptions): Promise<ResolvedConfig> {
  const env = opts.env ?? process.env;
  const config: VinaxConfig = { ...DEFAULTS };
  const notes: ConfigNote[] = [];
  const sources = ['defaults'];

  // 4. project config — strictest-only, applied first so later, more trusted
  //    layers can still override the preferences it expressed.
  const projectRaw =
    (await readJson(join(opts.root, '.vinax', 'config.json'))) ?? (await readJson(join(opts.root, '.vinax.json')));
  if (projectRaw) {
    notes.push(...applyProjectConfig(config, projectRaw));
    sources.push('project config');
  }

  // 3. user config
  const userFile = opts.userConfigFile === undefined ? paths(env).config : opts.userConfigFile;
  if (userFile) {
    const userRaw = await readJson(userFile);
    if (userRaw) {
      // The user's own file is trusted, but a project that tightened the
      // approval mode keeps that tightening: the point is protecting the
      // user, and they can still override on the command line.
      const beforeApproval = config.approval;
      applyTrusted(config, userRaw);
      if (projectRaw && APPROVAL_RANK[beforeApproval] < APPROVAL_RANK[config.approval] && str(projectRaw.approval)) {
        config.approval = beforeApproval;
      }
      sources.push('user config');
    }
  }

  // 2. safe environment overrides
  const apiBase = env.VINAX_API_BASE?.trim();
  if (apiBase) {
    config.apiBase = apiBase.replace(/\/+$/, '');
    sources.push('VINAX_API_BASE');
  }
  if (env.VINAX_ENGINE?.trim()) config.engine = env.VINAX_ENGINE.trim();
  if (env.VINAX_DEBUG === '1') config.debug = true;
  if (env.NO_COLOR !== undefined || env.TERM === 'dumb') config.color = false;

  // 1. CLI flags
  if (opts.flags) {
    for (const [k, v] of Object.entries(opts.flags)) {
      if (v === undefined || v === null) continue;
      (config as unknown as Record<string, unknown>)[k] = v;
    }
    sources.push('flags');
  }
  return { config, notes, sources };
}
