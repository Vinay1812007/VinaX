/**
 * The session controller — the object the interactive loop and the slash
 * commands both talk to.
 *
 * It owns the mutable state of one VinaX CLI session (config, conversation,
 * ledger, journal, permissions) and the operations that are useful outside
 * the agent loop: showing the diff, listing sessions, running doctor,
 * resolving `@file` references, printing the final summary.
 *
 * Keeping this separate from the loop is what lets `/status` and `/undo` work
 * on exactly the same state the agent is using, rather than a copy that has
 * quietly drifted.
 */
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { VinaxApi, type Meta } from '../api/client.js';
import type { VinaxConfig } from '../config/config.js';
import { PermissionEngine } from '../permissions/policy.js';
import { RunJournal, type UndoResult } from '../session/journal.js';
import { conversationFrom, listSessions, SessionStore } from '../session/store.js';
import { TaskLedger } from '../agent/ledger.js';
import type { Turn } from '../agent/context.js';
import type { Discovery } from '../context/discovery.js';
import { contextBlock } from '../context/discovery.js';
import { git, gitRoot } from '../tools/git/git.js';
import { resolvePath, type Workspace } from '../security/paths.js';
import { isProtectedPath, redact } from '../security/secrets.js';
import { clip } from '../utils/text.js';
import type { McpRegistry } from '../tools/mcp/client.js';
import { glyphs, paint, renderDiff, type Theme } from '../terminal/render.js';
import type { Output } from '../terminal/output.js';
import { CLI_VERSION } from '../version.js';
import { runDoctorChecks, renderDoctor } from './doctor.js';

export interface ControllerDeps {
  api: VinaxApi;
  config: VinaxConfig;
  ws: Workspace;
  discovery: Discovery;
  permissions: PermissionEngine;
  journal: RunJournal;
  ledger: TaskLedger;
  mcp: McpRegistry | null;
  session: SessionStore | null;
  out: Output;
  theme: Theme;
  conversation: Turn[];
  signal: () => AbortSignal;
}

export class SessionController {
  readonly version = CLI_VERSION;
  private metaCache: Meta | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  get api(): VinaxApi { return this.deps.api; }
  get config(): VinaxConfig { return this.deps.config; }
  get ws(): Workspace { return this.deps.ws; }
  get discovery(): Discovery { return this.deps.discovery; }
  get permissions(): PermissionEngine { return this.deps.permissions; }
  get journal(): RunJournal { return this.deps.journal; }
  get ledger(): TaskLedger { return this.deps.ledger; }
  get mcp(): McpRegistry | null { return this.deps.mcp; }
  get session(): SessionStore | null { return this.deps.session; }
  get out(): Output { return this.deps.out; }
  get theme(): Theme { return this.deps.theme; }
  get conversation(): Turn[] { return this.deps.conversation; }

  async meta(): Promise<Meta | null> {
    if (this.metaCache) return this.metaCache;
    try {
      this.metaCache = await this.deps.api.meta(this.deps.signal());
      return this.metaCache;
    } catch (e) {
      this.out.problem(`Could not reach the VinaX service: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  resetLedger(): void {
    const fresh = new TaskLedger();
    Object.assign(this.deps.ledger, {
      goal: '', state: 'Planning', plan: [], commands: [], commits: [], pushes: [], blockers: [],
      steps: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, startedAt: Date.now(),
    });
    this.deps.ledger.filesRead.clear();
    this.deps.ledger.filesChanged.clear();
    void fresh;
  }

  /**
   * Expand `@path` references in a user message.
   *
   * The path is resolved through the same workspace gate as every tool, so
   * `@../../etc/passwd` is refused here exactly as it would be refused there.
   * A protected file is named but not inlined — reading it needs the normal
   * permission flow, and a convenience syntax must not be a way around it.
   */
  async expandReferences(text: string): Promise<string> {
    const refs = [...text.matchAll(/(^|\s)@([\w./~@-]+)/g)].map((m) => m[2]);
    if (!refs.length) return text;
    const blocks: string[] = [];
    for (const ref of [...new Set(refs)].slice(0, 10)) {
      const r = await resolvePath(this.ws, ref);
      if (!r.ok) {
        blocks.push(`[@${ref} — ${r.detail}]`);
        continue;
      }
      if (isProtectedPath(r.display).protected) {
        blocks.push(`[@${ref} — this is a protected credential file; ask VinaX to read it and approve the prompt if you really mean it]`);
        continue;
      }
      const st = await stat(r.path).catch(() => null);
      if (!st) {
        blocks.push(`[@${ref} — no such path]`);
        continue;
      }
      if (st.isDirectory()) {
        blocks.push(`[@${ref} — directory: ${r.display}]`);
        continue;
      }
      const body = await readFile(r.path, 'utf8').catch(() => null);
      if (body === null) {
        blocks.push(`[@${ref} — could not be read as text]`);
        continue;
      }
      blocks.push(`--- ${r.display} (referenced with @) ---\n${clip(redact(body), 20_000).text}`);
    }
    return `${text}\n\n${blocks.join('\n\n')}`;
  }

  printStatus(): void {
    const { out, theme, ledger } = this.deps;
    const g = glyphs(theme);
    out.print('');
    if (ledger.goal) {
      out.print(paint(theme, 'bold', 'Goal'));
      out.print(`  ${ledger.goal}`);
      out.print('');
    }
    if (ledger.plan.length) {
      out.print(paint(theme, 'bold', 'Progress'));
      for (const s of ledger.plan) {
        const mark = s.status === 'done' ? paint(theme, 'green', g.ok) : s.status === 'doing' ? paint(theme, 'cyan', g.doing) : paint(theme, 'grey', g.todo);
        out.print(`  ${mark} ${s.text}`);
      }
      out.print('');
    }
    out.print(paint(theme, 'bold', 'State'));
    out.print(`  ${ledger.state}  ${paint(theme, 'grey', `· step ${ledger.steps} · ${ledger.toolCalls} tool calls`)}`);
    out.print('');
    const changed = this.journal.changedFiles();
    if (changed.length) {
      out.print(paint(theme, 'bold', 'Files changed'));
      for (const f of changed) out.print(`  ${f}`);
      out.print('');
    }
    if (ledger.commands.length) {
      out.print(paint(theme, 'bold', 'Validation'));
      for (const c of ledger.commands.slice(-5)) {
        const mark = c.exitCode === 0 ? paint(theme, 'green', g.ok) : paint(theme, 'red', g.fail);
        out.print(`  ${mark} ${c.command} — ${c.summary}`);
      }
      out.print('');
    }
    if (this.discovery.isGitRepo) {
      out.print(paint(theme, 'bold', 'Git'));
      out.print(`  ${ledger.branch || this.discovery.branch || '(detached)'}`);
      for (const c of ledger.commits) out.print(`  ${paint(theme, 'grey', c.hash)} ${c.message}`);
      for (const p of ledger.pushes) out.print(`  push ${p.remote}/${p.branch}: ${p.ok ? 'succeeded' : 'FAILED'}`);
      out.print('');
    }
  }

  /** The factual close-out printed when a run finishes. */
  printSummary(outcome: { reason: string; error: string | null }): void {
    const { out, theme, ledger } = this.deps;
    const g = glyphs(theme);
    const changed = this.journal.changedFiles();
    const hasAnything = changed.length || ledger.commands.length || ledger.commits.length || ledger.pushes.length;
    if (!hasAnything) return;

    out.print('');
    if (changed.length) {
      out.print(paint(theme, 'bold', 'Changed'));
      for (const f of changed) out.print(`  ${f}`);
      out.print('');
    }
    if (ledger.commands.length) {
      out.print(paint(theme, 'bold', 'Validation'));
      for (const c of ledger.commands.slice(-6)) {
        const mark = c.exitCode === 0 ? paint(theme, 'green', g.ok) : paint(theme, 'red', g.fail);
        out.print(`  ${c.command} ${mark} ${paint(theme, 'grey', c.summary)}`);
      }
      out.print('');
    }
    if (ledger.commits.length) {
      out.print(paint(theme, 'bold', 'Commits'));
      for (const c of ledger.commits) out.print(`  ${c.hash}  ${c.message}`);
      out.print('');
    }
    if (ledger.pushes.length) {
      out.print(paint(theme, 'bold', 'Push'));
      for (const p of ledger.pushes) {
        out.print(`  ${p.remote}/${p.branch}: ${p.ok ? paint(theme, 'green', 'succeeded') : paint(theme, 'red', 'FAILED')}`);
      }
      out.print('');
    }
    if (ledger.inputTokens || ledger.outputTokens) {
      out.print(paint(theme, 'grey', `  ${ledger.inputTokens.toLocaleString('en-US')} in / ${ledger.outputTokens.toLocaleString('en-US')} out tokens · ${(ledger.elapsedMs() / 1000).toFixed(0)}s`));
      out.print('');
    }
    if (outcome.error) {
      out.print(`${paint(theme, 'yellow', g.warn)} ${outcome.error}`);
      out.print('');
    }
  }

  async showDiff(): Promise<void> {
    const root = await gitRoot(this.ws.root, this.deps.signal());
    if (!root) {
      this.out.print('This workspace is not a Git repository, so there is no diff to show.');
      return;
    }
    const r = await git({ root, signal: this.deps.signal() }, ['diff', '--no-color']);
    const text = r.stdout.trim();
    if (!text) {
      this.out.print('The working tree has no unstaged changes.');
      return;
    }
    this.out.print(renderDiff(clip(redact(text), 20_000).text, this.theme));
  }

  /** The live free-model catalogue, or an empty list when it cannot be read. */
  async catalogGroups(): Promise<import('../api/client.js').CatalogGroup[]> {
    try {
      return await this.deps.api.catalog(this.deps.signal());
    } catch (e) {
      this.out.problem(`Could not load the live model menu: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  async showModels(): Promise<void> {
    const meta = await this.meta();
    if (!meta) return;
    const { out, theme } = this.deps;
    const g = glyphs(theme);
    out.print('');
    out.print(paint(theme, 'bold', 'Engines'));
    const width = Math.max(...meta.engines.map((e) => e.id.length));
    for (const e of meta.engines) {
      const current = e.id === this.config.engine ? paint(theme, 'cyan', g.doing) : ' ';
      const state = e.available ? '' : paint(theme, 'grey', ' (not configured)');
      out.print(`  ${current} ${e.id.padEnd(width)}  ${e.label}${state}`);
      out.print(`      ${paint(theme, 'grey', e.hint)}${e.acceptsModel ? paint(theme, 'grey', ' · --model applies') : ''}`);
    }
    const selectable = meta.engines.filter((e) => e.acceptsModel && e.available);
    if (selectable.length) {
      try {
        const groups = await this.deps.api.catalog(this.deps.signal());
        for (const group of groups) {
          if (!group.configured) continue;
          out.print('');
          out.print(paint(theme, 'bold', `${group.label} — live free models`));
          if (!group.models.length) {
            out.print(paint(theme, 'grey', '  (this key serves no free chat model right now)'));
            continue;
          }
          for (const m of group.models.slice(0, 40)) {
            out.print(`  ${m.id}${m.context ? paint(theme, 'grey', `  (${m.context.toLocaleString('en-US')} ctx)`) : ''}`);
          }
          if (group.models.length > 40) out.print(paint(theme, 'grey', `  … and ${group.models.length - 40} more`));
        }
      } catch (e) {
        out.problem(`Could not load the live model menu: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    out.print('');
  }

  async showSessions(): Promise<void> {
    const rows = await listSessions();
    const { out, theme } = this.deps;
    if (!rows.length) {
      out.print('No saved sessions yet.');
      return;
    }
    out.print('');
    out.print(paint(theme, 'bold', 'Sessions'));
    for (const r of rows.slice(0, 25)) {
      const when = new Date(r.updatedAt).toISOString().replace('T', ' ').slice(0, 16);
      out.print(`  ${r.id}  ${paint(theme, 'grey', when)}  ${r.title || '(no messages)'}`);
      out.print(`      ${paint(theme, 'grey', `${r.workspace}${r.branch ? ` · ${r.branch}` : ''} · ${r.messages} messages · ${r.filesChanged} files · ${r.status}`)}`);
    }
    out.print('');
  }

  async resume(id: string): Promise<boolean> {
    const entries = await SessionStore.read(id);
    if (!entries.length) return false;
    const turns = conversationFrom(entries);
    this.deps.conversation.length = 0;
    this.deps.conversation.push(...turns);
    // The ledger is rebuilt from the recorded facts, not from the prose: a
    // resumed session must know which files were changed and what was run.
    this.resetLedger();
    for (const e of entries) {
      if (e.t === 'file_changed') this.deps.ledger.filesChanged.add(e.path);
      if (e.t === 'command') this.deps.ledger.recordCommand({ command: e.command, exitCode: e.exitCode, ms: 0, summary: e.summary });
      if (e.t === 'user' && !this.deps.ledger.goal) this.deps.ledger.goal = e.text.slice(0, 160);
    }
    return true;
  }

  showMcp(): void {
    const { out, theme } = this.deps;
    if (!this.mcp) {
      out.print('No MCP servers are configured. Add one with: vinax mcp add <name> <command> [args…]');
      return;
    }
    const tools = this.mcp.tools();
    if (!tools.length) {
      out.print('MCP servers are configured but none are currently serving tools.');
      return;
    }
    out.print('');
    out.print(paint(theme, 'bold', 'External tools (MCP)'));
    const byServer = new Map<string, string[]>();
    for (const t of tools) {
      const list = byServer.get(t.server) ?? [];
      list.push(t.name);
      byServer.set(t.server, list);
    }
    for (const [server, names] of byServer) {
      out.print(`  ${server}: ${names.join(', ')}`);
    }
    out.print(paint(theme, 'grey', '  These go through the same approval prompts as built-in tools.'));
    out.print('');
  }

  async runDoctor(): Promise<void> {
    const checks = await runDoctorChecks({
      api: this.deps.api,
      config: this.config,
      ws: this.ws,
      discovery: this.discovery,
      mcp: this.mcp,
      signal: this.deps.signal(),
    });
    this.out.print(renderDoctor(checks, this.theme));
  }

  async undo(): Promise<UndoResult> {
    return this.journal.undoLast({
      readFile: (p) => readFile(p, 'utf8').then((t) => t).catch(() => null),
      writeFile: (p, c) => writeFile(p, c, 'utf8'),
      removeFile: (p) => rm(p, { force: true }),
    });
  }

  /** Refresh the git facts between turns, so the model is never told stale state. */
  async refreshDiscovery(): Promise<void> {
    if (!this.discovery.isGitRepo) return;
    const branch = await git({ root: this.ws.root, signal: this.deps.signal() }, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch.ok) this.deps.discovery.branch = branch.stdout.trim();
  }

  contextBlock(): string {
    return contextBlock(this.discovery);
  }
}
