/** Shared shapes for every local tool. */
import type { VinaxApi } from '../api/client.js';
import type { VinaxConfig } from '../config/config.js';
import type { PermissionEngine } from '../permissions/policy.js';
import type { Workspace } from '../security/paths.js';
import type { RunJournal } from '../session/journal.js';
import type { TaskLedger } from '../agent/ledger.js';
import type { McpRegistry } from './mcp/client.js';

export interface ToolResult {
  ok: boolean;
  /** What goes back to the model. Already redacted and clipped. */
  content: string;
  /** Structured extras for the terminal, never sent to the model verbatim. */
  meta?: Record<string, unknown>;
  /** Set when the failure was a refused permission, so the run can stop cleanly. */
  permissionDenied?: boolean;
}

/** Progress the terminal shows while a tool runs. */
export interface ToolUi {
  /** A step line: "Read package.json", "Running npm test". */
  step(text: string): void;
  /** Streamed child-process output. */
  stream(chunk: string, source: 'stdout' | 'stderr'): void;
  /** A diff about to be applied, or applied. */
  diff(path: string, unified: string): void;
  note(text: string): void;
}

export interface ToolContext {
  ws: Workspace;
  config: VinaxConfig;
  permissions: PermissionEngine;
  journal: RunJournal;
  ledger: TaskLedger;
  api: VinaxApi;
  ui: ToolUi;
  mcp: McpRegistry | null;
  /** Aborted on Ctrl+C. Every long operation must honour it. */
  signal: AbortSignal;
  /** Identifier grouping the edits of one agent step, for undo. */
  editGroup: string;
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export const ok = (content: string, meta?: Record<string, unknown>): ToolResult =>
  meta ? { ok: true, content, meta } : { ok: true, content };

export const fail = (content: string, meta?: Record<string, unknown>): ToolResult =>
  meta ? { ok: false, content, meta } : { ok: false, content };

/** A string argument, or '' when absent. */
export const argStr = (args: Record<string, unknown>, key: string, fallback = ''): string =>
  typeof args[key] === 'string' ? (args[key] as string) : fallback;

export const argNum = (args: Record<string, unknown>, key: string, fallback: number): number =>
  typeof args[key] === 'number' && Number.isFinite(args[key] as number) ? (args[key] as number) : fallback;

export const argBool = (args: Record<string, unknown>, key: string, fallback = false): boolean =>
  typeof args[key] === 'boolean' ? (args[key] as boolean) : fallback;

export const argList = (args: Record<string, unknown>, key: string): string[] =>
  Array.isArray(args[key]) ? (args[key] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
