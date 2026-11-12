/**
 * VinaX AI — Cowork: Claude working through a task from start to finish in
 * its own workspace, on Anthropic's Managed Agents (beta). Anthropic runs
 * the agent loop and a container per task (bash, file tools, web search and
 * fetch, the docx / xlsx / pptx / pdf skills); the Worker only creates the
 * task, relays the person's messages and passes the event stream through.
 * The same accounts as Claude (claudeAccess.ts) may use it; it runs on the
 * owner's ANTHROPIC_API_KEY.
 *
 * The agent and the environment are created once and their ids kept in the
 * `vinax-cowork` setting (`ensureSetup`); a change to their definition here
 * updates them in place (a new agent version) instead of making new ones.
 * Every task is a session tagged `metadata.app = "vinax-cowork"`, and the
 * routes refuse any other session id. Each task gets a hard spend cap
 * (`budget`, list price, USD) so a runaway task pauses instead of spending.
 *
 * Raw fetch, like the chat's adapters: the stream is handed to the page
 * untouched (the free plan's CPU), and the page reads the events itself
 * (frontend features/vinaxai/cowork).
 */
import { setting, writeSetting } from '../settings';
import type { DbEnv } from '../db';
import type { AiEnv } from './types';

export const MA_BASE = 'https://api.anthropic.com/v1';
export const MA_VERSION = '2026-10-21';
export const MA_BETA = 'managed-agents-2026-04-01';
export const COWORK_SETTING_KEY = 'vinax-cowork';
export const COWORK_APP = 'vinax-cowork';

/** The models a task may run on (ids are Anthropic's); the first is the agent's own. */
export const COWORK_MODELS: ReadonlyArray<{ id: string; name: string; description: string }> = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', description: 'Best for most tasks' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', description: 'Quicker and cheaper' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', description: 'Quickest, for small jobs' },
  { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', description: 'Most capable, costs the most' },
];
export const COWORK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type CoworkEffort = (typeof COWORK_EFFORTS)[number];
export const DEFAULT_EFFORT: CoworkEffort = 'high';

/** Spend cap per task, in US cents: $5 unless the owner sets another default. */
export const DEFAULT_BUDGET_CENTS = 500;
export const MIN_BUDGET_CENTS = 50;
export const MAX_BUDGET_CENTS = 20_000;
/** A file the person attaches (Anthropic's Files API takes more; the Worker passes the bytes through). */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
export const MAX_MESSAGE_CHARS = 100_000;

export const COWORK_SYSTEM = [
  'You are VinaX Cowork, the agent mode of VinaX AI (vinaxmusic.online). You take a task from the person and carry it through to the end in your own workspace: a Linux container with bash, file tools, web search and web fetch, and skills for Word, Excel, PowerPoint and PDF files.',
  '',
  'How to work:',
  '- Start with a short plan (three to six steps) in one message, then do the work. Before each major step, say in one line what you are doing.',
  '- Files the person attached are under /mnt/session/uploads/ (read-only). Work in /workspace.',
  '- Save every deliverable (documents, spreadsheets, slides, code, images, data, reports) to /mnt/session/outputs/ with a clear file name. The person downloads them from there; nothing outside that folder reaches them.',
  '- Check your work before you call it done: run the code, open the file you wrote, re-read the numbers.',
  '- When you use the web, link the pages you relied on.',
  '- Ask a question only when you cannot go on without the answer; otherwise make a sensible choice and say what you chose.',
  '- When you finish, reply with a short summary: what you did, the files in /mnt/session/outputs/, and anything you could not do.',
].join('\n');

export const AGENT_DEFINITION = {
  name: 'VinaX Cowork',
  description: 'VinaX AI Cowork: carries a task through in its own workspace and hands back files.',
  model: { id: COWORK_MODELS[0].id, effort: DEFAULT_EFFORT },
  system: COWORK_SYSTEM,
  tools: [
    {
      type: 'agent_toolset_20260401',
      // auto: the server runs safe calls, denies high-risk ones and pauses on the rest for the person's Allow / Deny.
      default_config: { enabled: true, permission_policy: { type: 'auto' } },
      // Research is part of the job, so both web tools are on.
      configs: [
        { name: 'web_search', enabled: true },
        { name: 'web_fetch', enabled: true },
      ],
    },
  ],
  skills: ['docx', 'xlsx', 'pptx', 'pdf'].map((skill_id) => ({ type: 'anthropic', skill_id })),
  metadata: { app: COWORK_APP },
};

/**
 * Unrestricted egress (Anthropic's safety blocklist still applies): `limited`
 * would also limit web search and fetch to a fixed host list, and research
 * tasks reach any site. Package managers work either way.
 */
export const ENVIRONMENT_DEFINITION = {
  name: 'vinax-cowork',
  description: 'Workspace for VinaX Cowork tasks.',
  config: { type: 'cloud', networking: { type: 'unrestricted' } },
  metadata: { app: COWORK_APP },
};

/** FNV-1a of the definitions: a change here updates the agent and environment once. */
export function definitionHash(): string {
  const text = JSON.stringify([AGENT_DEFINITION, ENVIRONMENT_DEFINITION]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export interface CoworkSetting {
  agentId: string | null;
  agentVersion: number | null;
  environmentId: string | null;
  hash: string | null;
  /** The cap a new task gets, in US cents. */
  budgetCents: number;
}

const str = (v: unknown, re: RegExp): string | null => (typeof v === 'string' && re.test(v) ? v : null);
export const AGENT_ID = /^agent_[A-Za-z0-9]{6,80}$/;
export const ENV_ID = /^env_[A-Za-z0-9]{6,80}$/;
export const SESSION_ID = /^sesn_[A-Za-z0-9]{6,80}$/;
export const FILE_ID = /^file_[A-Za-z0-9]{6,80}$/;
export const EVENT_ID = /^sevt_[A-Za-z0-9]{6,80}$/;

export const clampBudget = (v: unknown, fallback = DEFAULT_BUDGET_CENTS): number => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? Math.min(MAX_BUDGET_CENTS, Math.max(MIN_BUDGET_CENTS, Math.round(n))) : fallback;
};

export function sanitizeCoworkSetting(raw: unknown): CoworkSetting {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const version = Number(v.agentVersion);
  return {
    agentId: str(v.agentId, AGENT_ID),
    agentVersion: Number.isInteger(version) && version >= 1 ? version : null,
    environmentId: str(v.environmentId, ENV_ID),
    hash: typeof v.hash === 'string' && v.hash.length <= 16 ? v.hash : null,
    budgetCents: clampBudget(v.budgetCents),
  };
}

export async function coworkSetting(env: DbEnv): Promise<CoworkSetting> {
  return sanitizeCoworkSetting(await setting(env, COWORK_SETTING_KEY));
}

export interface MaResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  body: T;
}

/** The headers every Managed Agents call carries. */
export function maHeaders(env: AiEnv, beta = true, json = true): Record<string, string> {
  return {
    'x-api-key': env.ANTHROPIC_API_KEY?.trim() ?? '',
    'anthropic-version': MA_VERSION,
    ...(beta ? { 'anthropic-beta': MA_BETA } : {}),
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

/** One JSON call to the Managed Agents API. Never throws: a network failure is status 0. */
export async function maJson<T = Record<string, unknown>>(env: AiEnv, path: string, init: { method?: string; body?: unknown; beta?: boolean; signal?: AbortSignal } = {}): Promise<MaResult<T>> {
  try {
    const res = await fetch(`${MA_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: maHeaders(env, init.beta !== false, init.body !== undefined),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: init.signal,
    });
    const text = await res.text().catch(() => '');
    let body: unknown = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    return { ok: res.ok, status: res.status, body: body as T };
  } catch {
    return { ok: false, status: 0, body: {} as T };
  }
}

/** Anthropic's error message, short, for the owner's own page (never a key or a header). */
export function maError(r: MaResult<unknown>): { error: string; status: number; message?: string } {
  const e = (r.body as { error?: { type?: unknown; message?: unknown } } | null)?.error;
  const message = typeof e?.message === 'string' ? e.message.slice(0, 300) : undefined;
  return { error: r.status === 0 ? 'network' : 'upstream', status: r.status, ...(message ? { message } : {}) };
}

export type SetupResult = { ok: true; setting: CoworkSetting; created: boolean; updated: boolean } | { ok: false; step: 'environment' | 'agent' | 'save'; failure: MaResult<unknown> | null };

/**
 * The agent and environment, made once and kept in the setting; a changed
 * definition updates both in place. Called by POST /api/ai/cowork/setup and
 * before a task starts (only the first ever call creates anything).
 */
export async function ensureSetup(env: AiEnv): Promise<SetupResult> {
  const s = await coworkSetting(env);
  const hash = definitionHash();
  if (s.agentId && s.environmentId && s.hash === hash) return { ok: true, setting: s, created: false, updated: false };
  let created = false;
  let updated = false;
  let environmentId = s.environmentId;
  if (!environmentId) {
    const r = await maJson<{ id?: unknown }>(env, '/environments', { method: 'POST', body: ENVIRONMENT_DEFINITION });
    environmentId = r.ok ? str(r.body.id, ENV_ID) : null;
    if (!environmentId) return { ok: false, step: 'environment', failure: r };
    created = true;
  } else if (s.hash !== hash) {
    // Changes apply to new containers only; running tasks keep theirs.
    const r = await maJson(env, `/environments/${environmentId}`, { method: 'POST', body: ENVIRONMENT_DEFINITION });
    if (!r.ok) return { ok: false, step: 'environment', failure: r };
    updated = true;
  }
  let agentId = s.agentId;
  let agentVersion = s.agentVersion;
  const r = agentId
    ? s.hash === hash ? null : await maJson<{ id?: unknown; version?: unknown }>(env, `/agents/${agentId}`, { method: 'POST', body: AGENT_DEFINITION })
    : await maJson<{ id?: unknown; version?: unknown }>(env, '/agents', { method: 'POST', body: AGENT_DEFINITION });
  if (r) {
    agentId = r.ok ? str(r.body.id, AGENT_ID) : null;
    if (!agentId) return { ok: false, step: 'agent', failure: r };
    const v = Number(r.body.version);
    agentVersion = Number.isInteger(v) && v >= 1 ? v : agentVersion;
    if (s.agentId) updated = true;
    else created = true;
  }
  const next: CoworkSetting = { agentId, agentVersion, environmentId, hash, budgetCents: s.budgetCents };
  const saved = await writeSetting(env, COWORK_SETTING_KEY, next, 'vinax-cowork');
  if (!saved.ok) return { ok: false, step: 'save', failure: null };
  return { ok: true, setting: next, created, updated };
}

export interface SessionSummary {
  id: string;
  title: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** List-priced spend so far, in US cents. */
  costCents: number | null;
  budgetCents: number | null;
  model: string | null;
}

const cents = (v: unknown): number | null => {
  const n = Number((v as { amount?: unknown } | null)?.amount);
  return Number.isFinite(n) ? n : null;
};

export function sessionSummary(raw: unknown): SessionSummary | null {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const id = str(s?.id, SESSION_ID);
  if (!s || !id) return null;
  const agent = s.agent as { model?: unknown } | undefined;
  const model = typeof agent?.model === 'string' ? agent.model : typeof (agent?.model as { id?: unknown } | undefined)?.id === 'string' ? (agent!.model as { id: string }).id : null;
  return {
    id,
    title: typeof s.title === 'string' && s.title ? s.title.slice(0, 200) : 'Untitled task',
    status: typeof s.status === 'string' ? s.status : 'idle',
    createdAt: typeof s.created_at === 'string' ? s.created_at : null,
    updatedAt: typeof s.updated_at === 'string' ? s.updated_at : null,
    costCents: cents((s.usage as { list_cost?: unknown } | undefined)?.list_cost),
    budgetCents: cents((s.budget as { max_list_cost?: unknown } | undefined)?.max_list_cost),
    model,
  };
}

/** Is this one of Cowork's sessions (and not archived)? */
export const isCoworkSession = (raw: unknown): boolean => {
  const s = raw as { metadata?: { app?: unknown }; archived_at?: unknown } | null;
  return s?.metadata?.app === COWORK_APP && !s?.archived_at;
};

/** A file name safe for a mount path and a download header. */
export function safeFileName(raw: unknown, fallback = 'file'): string {
  const name = typeof raw === 'string' ? raw.normalize('NFC') : '';
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return clean || fallback;
}

/** The person's message as the agent receives it. */
export function userMessage(text: string): Record<string, unknown> {
  return { type: 'user.message', content: [{ type: 'text', text }] };
}

/** The session's agent: the agent itself, or with another model / effort for this task only. */
export function sessionAgent(s: CoworkSetting, model: string, effort: CoworkEffort): unknown {
  const ref = { id: s.agentId, ...(s.agentVersion ? { version: s.agentVersion } : {}) };
  if (model === AGENT_DEFINITION.model.id && effort === AGENT_DEFINITION.model.effort) return { type: 'agent', ...ref };
  // A model override replaces the agent's model object in full, so effort goes with it.
  return { type: 'agent_with_overrides', ...ref, model: { id: model, effort } };
}
