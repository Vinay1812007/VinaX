/**
 * Shared test scaffolding.
 *
 * Everything here works in a fresh temporary directory. No test touches the
 * developer's real repository, real ~/.vinax, or real network — a test suite
 * for a tool that edits files and runs git had better be scrupulous about
 * that, since a bug in the suite would otherwise land on the machine running it.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PermissionEngine, type ActionRequest } from '../src/permissions/policy.js';
import { RunJournal } from '../src/session/journal.js';
import { TaskLedger } from '../src/agent/ledger.js';
import { makeWorkspace, type Workspace } from '../src/security/paths.js';
import { DEFAULTS, type VinaxConfig } from '../src/config/config.js';
import { VinaxApi } from '../src/api/client.js';
import type { ToolContext, ToolUi } from '../src/tools/types.js';

export async function tempDir(prefix = 'vinax-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body, 'utf8');
  }
}

/** A UI that records everything instead of writing to a terminal. */
export function recordingUi(): ToolUi & { steps: string[]; notes: string[]; diffs: string[]; output: string } {
  const rec = {
    steps: [] as string[],
    notes: [] as string[],
    diffs: [] as string[],
    output: '',
    step(text: string) { rec.steps.push(text); },
    note(text: string) { rec.notes.push(text); },
    diff(_path: string, unified: string) { rec.diffs.push(unified); },
    stream(chunk: string) { rec.output += chunk; },
  };
  return rec;
}

export interface TestContextOptions {
  root: string;
  extraRoots?: string[];
  config?: Partial<VinaxConfig>;
  /** How the permission engine answers. Default: allow everything once. */
  answer?: (req: ActionRequest) => 'once' | 'session' | 'reject';
  /** Omit the prompter entirely, i.e. simulate a non-interactive run. */
  nonInteractive?: boolean;
  signal?: AbortSignal;
}

export interface TestContext extends ToolContext {
  ui: ReturnType<typeof recordingUi>;
  asked: ActionRequest[];
}

export async function testContext(opts: TestContextOptions): Promise<TestContext> {
  const ws: Workspace = await makeWorkspace(opts.root, opts.extraRoots ?? []);
  const asked: ActionRequest[] = [];
  const permissions = new PermissionEngine({ mode: opts.config?.approval ?? 'ask' });
  if (!opts.nonInteractive) {
    permissions.setPrompter(async (req) => {
      asked.push(req);
      return opts.answer ? opts.answer(req) : 'once';
    });
  }
  const ui = recordingUi();
  return {
    ws,
    config: { ...DEFAULTS, ...opts.config },
    permissions,
    journal: new RunJournal(),
    ledger: new TaskLedger(),
    api: new VinaxApi({ apiBase: 'http://127.0.0.1:1' }),
    ui,
    mcp: null,
    signal: opts.signal ?? new AbortController().signal,
    editGroup: 'test-group',
    asked,
  };
}

/** Is git usable here? The git suites skip themselves rather than fail. */
export function hasGit(): boolean {
  const r = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

/** Create a repository with an initial commit, isolated from user config. */
export async function initRepo(dir: string): Promise<void> {
  const run = (args: string[]): void => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: gitEnv() });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  };
  run(['init', '--initial-branch=main']);
  run(['config', 'user.email', 'test@vinax.invalid']);
  run(['config', 'user.name', 'VinaX Test']);
  run(['config', 'commit.gpgsign', 'false']);
}

/**
 * A git environment that cannot reach the developer's own config, hooks or
 * credentials — the suite must be unable to affect the real machine.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'VinaX Test',
    GIT_AUTHOR_EMAIL: 'test@vinax.invalid',
    GIT_COMMITTER_NAME: 'VinaX Test',
    GIT_COMMITTER_EMAIL: 'test@vinax.invalid',
  };
}

export function gitRun(dir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: gitEnv() });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
