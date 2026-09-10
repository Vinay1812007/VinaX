/**
 * Starting a VinaX CLI session, and running it.
 *
 * `bootstrap` assembles everything a run needs — workspace, discovery,
 * configuration, permission engine, output, MCP — and hands back a controller.
 * `runInteractive` and `runOnce` are the two ways that controller is driven.
 *
 * Interrupt handling lives here because it is a whole-session concern:
 *
 *   during a turn      Ctrl+C aborts the model request and any running child
 *                      process tree, and returns to the prompt. It does not
 *                      exit — losing an hour of context to a mistyped key is
 *                      not acceptable.
 *   at the prompt      Ctrl+C says how to leave. A second one exits.
 *   on exit            every child VinaX started is killed, so no dev server
 *                      or test worker outlives the session.
 */
import { resolve } from 'node:path';
import { VinaxApi } from '../api/client.js';
import { parseArgs, type ParsedArgs } from '../config/args.js';
import { resolveConfig, type VinaxConfig } from '../config/config.js';
import { ensureDirs } from '../config/paths.js';
import { discover } from '../context/discovery.js';
import { makeWorkspace } from '../security/paths.js';
import { PermissionEngine } from '../permissions/policy.js';
import { RunJournal } from '../session/journal.js';
import { SessionStore } from '../session/store.js';
import { TaskLedger } from '../agent/ledger.js';
import { runAgentTurn, type RunOutcome } from '../agent/loop.js';
import type { Turn } from '../agent/context.js';
import { McpRegistry } from '../tools/mcp/client.js';
import { killAllChildren } from '../tools/process/runner.js';
import { detectTheme, glyphs, paint, sessionHeader, type Theme } from '../terminal/render.js';
import { InteractiveOutput, JsonOutput, TerminalOutput, type Output } from '../terminal/output.js';
import { createPrompter } from '../terminal/prompt.js';
import { TerminalApp } from '../terminal/app.js';
import { slashMenuItems, handleSlash } from '../terminal/slash.js';
import { SessionController } from './controller.js';
import { EXIT, type ExitCode } from '../utils/exit.js';
import { CLI_VERSION } from '../version.js';
import { DEFAULT_API_BASE } from '../config/config.js';

export interface Bootstrapped {
  controller: SessionController;
  theme: Theme;
  out: Output;
  config: VinaxConfig;
  /** The signal for the turn in flight. Replaced at the start of each turn. */
  currentSignal: () => AbortSignal;
  /** Begin a new turn, replacing the abort scope. */
  newTurnSignal: () => AbortController;
  /** Cancel the turn in flight, if any. Safe to call at the prompt. */
  abortTurn: () => void;
  /** The interactive terminal, when there is one. */
  app: TerminalApp | null;
  mcp: McpRegistry | null;
  notes: string[];
}

/** Flags that map straight onto config keys. */
function flagsFrom(args: ParsedArgs): Partial<VinaxConfig> {
  const flags: Partial<VinaxConfig> = {};
  if (args.engine) flags.engine = args.engine;
  if (args.model) flags.model = args.model;
  if (args.approval) flags.approval = args.approval;
  if (args.web !== null) flags.web = args.web;
  if (args.maxSteps !== null) flags.maxSteps = args.maxSteps;
  if (args.debug) flags.debug = true;
  if (args.color !== null) flags.color = args.color;
  return flags;
}

export interface BootstrapOverrides {
  /**
   * Supply the terminal instead of deriving it from process.stdin.
   *
   * A test seam, and the only way to exercise the real interactive loop
   * without a pseudo-terminal. Deliberately a parameter rather than an
   * environment variable: an env var that forced raw mode could be set by
   * accident and would hang a user's pipeline.
   */
  app?: TerminalApp;
}

export async function bootstrap(args: ParsedArgs, overrides: BootstrapOverrides = {}): Promise<Bootstrapped> {
  const cwd = resolve(args.cwd ?? process.cwd());
  let controller: AbortController = new AbortController();
  const bootSignal = controller.signal;

  const discovery = await discover(cwd, bootSignal);
  const ws = await makeWorkspace(discovery.workspaceRoot, args.addDirs.map((d) => resolve(cwd, d)));
  const { config, notes: configNotes } = await resolveConfig({ root: ws.root, flags: flagsFrom(args) });

  const theme = detectTheme({ color: config.color });
  const interactiveTty =
    args.output === 'interactive' && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);

  // One terminal owner, created only when there is a terminal to own.
  const app = overrides.app ?? (interactiveTty ? new TerminalApp({ theme, interactive: true }) : null);
  const out: Output = app
    ? new InteractiveOutput(app, theme)
    : args.output === 'json'
      ? new JsonOutput()
      : new TerminalOutput(theme, { showCommandOutput: false });

  const api = new VinaxApi({ apiBase: config.apiBase });
  await ensureDirs();

  // MCP servers are started once and shared for the session.
  const mcpConfigs = await McpRegistry.load();
  let mcp: McpRegistry | null = null;
  const notes = configNotes.map((n) => `${n.level === 'warn' ? 'Note' : 'Note'}: ${n.message}`);
  if (mcpConfigs.length) {
    mcp = new McpRegistry(mcpConfigs);
    for (const r of await mcp.connectAll()) {
      if (!r.ok) notes.push(`MCP server "${r.name}" did not start: ${r.error ?? 'unknown error'}`);
    }
  }

  const journal = new RunJournal();
  const ledger = new TaskLedger();
  ledger.branch = discovery.branch;
  const conversation: Turn[] = [];

  const session = await SessionStore.create({
    workspace: ws.root,
    branch: discovery.branch,
    engine: config.engine,
    model: config.model,
    cliVersion: CLI_VERSION,
  }).catch(() => null);

  const currentSignal = (): AbortSignal => controller.signal;
  const newTurnSignal = (): AbortController => {
    controller = new AbortController();
    return controller;
  };
  const abortTurn = (): void => controller.abort();

  // Built with no prompter on purpose. A non-interactive run must be unable
  // to block on a question; runInteractive() attaches one once it owns a
  // terminal to ask through.
  const permissions = new PermissionEngine({
    mode: config.approval,
    onDecision: (req, decision) => {
      void session?.append({
        t: 'permission',
        at: Date.now(),
        action: `${req.kind}:${req.title}`,
        outcome: decision.outcome,
      });
    },
  });

  const ctl = new SessionController({
    api, config, ws, discovery, permissions, journal, ledger, mcp, session,
    out, theme, conversation, signal: currentSignal,
  });

  return { controller: ctl, theme, out, config, currentSignal, newTurnSignal, abortTurn, app, mcp, notes };
}

/** Map a run outcome onto the documented exit codes. */
export function exitCodeFor(outcome: RunOutcome): ExitCode {
  switch (outcome.reason) {
    case 'completed': return EXIT.ok;
    case 'interrupted': return EXIT.interrupted;
    case 'permission_denied': return EXIT.permissionDenied;
    case 'max_steps': return EXIT.maxSteps;
    case 'api_error': return EXIT.api;
    case 'tool_failure': return EXIT.toolFailure;
    default: return EXIT.failure;
  }
}

async function turn(boot: Bootstrapped, text: string): Promise<RunOutcome> {
  const ctl = boot.controller;
  const controller = boot.newTurnSignal();
  const expanded = await ctl.expandReferences(text);
  await ctl.refreshDiscovery();
  const outcome = await runAgentTurn(
    {
      api: ctl.api,
      config: ctl.config,
      ws: ctl.ws,
      permissions: ctl.permissions,
      journal: ctl.journal,
      ledger: ctl.ledger,
      mcp: ctl.mcp,
      session: ctl.session,
      discovery: ctl.discovery,
      ui: boot.out,
      observer: boot.out,
      conversation: ctl.conversation,
    },
    expanded,
    controller.signal,
  );
  boot.out.finish();
  return outcome;
}

/** One prompt, one answer, then exit — `-p`, `exec`, and `--json`. */
export async function runOnce(boot: Bootstrapped, prompt: string, json: boolean): Promise<ExitCode> {
  // A non-interactive run has no prompt to return to, so Ctrl+C means stop:
  // cancel the model stream, kill any child tree, and let the loop report an
  // interrupted outcome with the documented exit code.
  const sigint = (): void => {
    boot.abortTurn();
    killAllChildren();
  };
  process.on('SIGINT', sigint);
  try {
    const outcome = await turn(boot, prompt);
    if (json) {
      (boot.out as JsonOutput).final?.(outcome.finalText);
    } else if (outcome.finalText) {
      (boot.out as TerminalOutput).renderReply?.(outcome.finalText);
    }
    if (!json) boot.controller.printSummary(outcome);
    if (outcome.error && !json) boot.out.problem(outcome.error);
    await boot.controller.session?.finish(outcome.reason === 'completed' ? 'completed' : outcome.reason === 'interrupted' ? 'interrupted' : 'failed');
    return exitCodeFor(outcome);
  } finally {
    process.off('SIGINT', sigint);
    boot.mcp?.stopAll();
    killAllChildren();
  }
}

/**
 * The interactive session.
 *
 * TerminalApp owns stdin and the live region; this loop only decides what to
 * ask for next. Note what is NOT here any more: no readline, no completer, no
 * second SIGINT handler competing with the app's, and — the bug this replaces
 * — no reprinting of the final answer after it has already streamed.
 */
export async function runInteractive(boot: Bootstrapped): Promise<ExitCode> {
  const { out, theme, controller: ctl, app } = boot;
  const g = glyphs(theme);
  if (!app) return EXIT.usage;

  let running = false;

  // ONE interrupt owner. The app routes Ctrl+C here; during a turn it cancels
  // the turn, and at the prompt the app handles clear/exit itself.
  app.setInterruptHandler(() => {
    if (!running) return false;
    boot.abortTurn();
    killAllChildren();
    app.endActivity('interrupted', 'Interrupted');
    out.print(paint(theme, 'yellow', `${g.warn} Stopped this turn. The session is still open.`));
    return true;
  });

  app.setSlashCommands(slashMenuItems());
  app.start();
  ctl.permissions.setPrompter(createPrompter(app));
  const syncStatus = (): void => {
    app.setStatus({
      approval: ctl.config.approval,
      engine: ctl.config.engine,
      web: ctl.config.web,
      ...(ctl.discovery.branch ? { branch: ctl.discovery.branch } : {}),
    });
  };
  syncStatus();

  out.print(
    sessionHeader(theme, {
      project: ctl.ws.root,
      branch: ctl.discovery.branch,
      engine: ctl.config.engine,
      approval: ctl.config.approval,
      web: ctl.config.web,
      apiBase: ctl.api.apiBase,
      showApiBase: ctl.api.apiBase !== DEFAULT_API_BASE,
    }),
  );
  for (const n of boot.notes) out.print(paint(theme, 'yellow', `${g.warn} ${n}`));
  if (ctl.discovery.instructionFiles.length) {
    out.print(paint(theme, 'grey', `  Project instructions: ${ctl.discovery.instructionFiles.join(', ')}`));
  }
  if (ctl.discovery.dirtyFiles.length) {
    out.print(
      paint(theme, 'grey', `  ${ctl.discovery.dirtyFiles.length} file(s) already modified before this session — VinaX will leave them alone.`),
    );
  }

  let exitCode: ExitCode = EXIT.ok;

  try {
    for (;;) {
      const line = await app.readLine();
      if (line === null) break; // Ctrl+D on an empty line, or a second Ctrl+C
      const trimmed = line.trim();
      if (!trimmed) continue;

      const slash = await handleSlash(trimmed, ctl, app);
      syncStatus();
      if (slash.exit) break;
      if (slash.handled) continue;

      running = true;
      const interactiveOut = out instanceof InteractiveOutput ? out : null;
      interactiveOut?.resetTurn();
      let outcome: RunOutcome;
      try {
        outcome = await turn(boot, trimmed);
      } finally {
        running = false;
      }

      // THE DUPLICATE-ANSWER FIX. The streamed deltas ARE the visible answer;
      // printing finalText afterwards showed the same reply twice. Only fall
      // back to printing it when nothing was streamed — an engine that
      // answered without deltas, or a run that ended before the first token.
      if (outcome.finalText && !interactiveOut?.streamedAnything()) {
        (out as TerminalOutput).renderReply?.(outcome.finalText);
      }

      ctl.printSummary(outcome);
      if (outcome.reason === 'permission_denied') {
        out.print(paint(theme, 'grey', '  Change what VinaX may do with /permissions, then ask again.'));
      }
      if (outcome.reason === 'max_steps') {
        out.print(paint(theme, 'grey', '  Say "continue" to carry on from where it stopped.'));
      }
      exitCode = exitCodeFor(outcome);
      syncStatus();
      await ctl.session?.checkpoint();
    }
  } finally {
    // Every exit path restores the terminal: raw mode off, cursor shown,
    // bracketed paste disabled, children reaped.
    app.stop();
    await ctl.session?.finish('completed');
    boot.mcp?.stopAll();
    killAllChildren();
  }
  return exitCode === EXIT.interrupted ? EXIT.ok : exitCode;
}

export { parseArgs };
