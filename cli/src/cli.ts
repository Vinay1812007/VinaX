#!/usr/bin/env node
/**
 * The `vinax` binary.
 *
 * Parse, dispatch, exit with a documented code. Everything interesting
 * happens in commands/; this file's whole job is to make sure that whatever
 * happens, the process ends with a number a script can act on and a message a
 * person can act on — and never a raw stack trace unless --debug asked for one.
 */
import { parseArgs } from './config/args.js';
import { bootstrap, runInteractive, runOnce } from './commands/run.js';
import { helpText } from './commands/help.js';
import { mcpCommand } from './commands/mcp.js';
import { doctorExitCode, renderDoctor, runDoctorChecks } from './commands/doctor.js';
import { listSessions } from './session/store.js';
import { detectTheme, paint } from './terminal/render.js';
import { EXIT, type ExitCode } from './utils/exit.js';
import { CLI_VERSION } from './version.js';
import { killAllChildren } from './tools/process/runner.js';

async function main(argv: string[]): Promise<ExitCode> {
  const args = parseArgs(argv);
  if (args.error) {
    process.stderr.write(`vinax: ${args.error}\n\nRun vinax --help for usage.\n`);
    return EXIT.usage;
  }

  switch (args.command.kind) {
    case 'help':
      process.stdout.write(helpText());
      return EXIT.ok;
    case 'version':
      process.stdout.write(`${CLI_VERSION}\n`);
      return EXIT.ok;
    case 'mcp':
      return mcpCommand(args.command.action, args.command.rest, detectTheme({ color: args.color }));
    default:
      break;
  }

  // `sessions` needs no workspace, no service and no permissions.
  if (args.command.kind === 'sessions') {
    const rows = await listSessions();
    const theme = detectTheme({ color: args.color });
    if (!rows.length) {
      process.stdout.write('No saved sessions yet.\n');
      return EXIT.ok;
    }
    for (const r of rows.slice(0, 50)) {
      const when = new Date(r.updatedAt).toISOString().replace('T', ' ').slice(0, 16);
      process.stdout.write(`${r.id}  ${paint(theme, 'grey', when)}  ${r.title || '(no messages)'}\n`);
      process.stdout.write(
        `${paint(theme, 'grey', `    ${r.workspace}${r.branch ? ` · ${r.branch}` : ''} · ${r.messages} messages · ${r.filesChanged} files · ${r.status}`)}\n`,
      );
    }
    return EXIT.ok;
  }

  const boot = await bootstrap(args);

  if (args.command.kind === 'doctor') {
    const checks = await runDoctorChecks({
      api: boot.controller.api,
      config: boot.config,
      ws: boot.controller.ws,
      discovery: boot.controller.discovery,
      mcp: boot.mcp,
      signal: boot.currentSignal(),
    });
    process.stdout.write(renderDoctor(checks, boot.theme));
    boot.mcp?.stopAll();
    return doctorExitCode(checks) === 0 ? EXIT.ok : EXIT.failure;
  }

  if (args.command.kind === 'models') {
    await boot.controller.showModels();
    boot.mcp?.stopAll();
    return EXIT.ok;
  }

  // --continue / --resume restore an earlier conversation before the first turn.
  if (args.continueLast || args.resumeId) {
    const rows = await listSessions();
    const wanted = args.resumeId
      ? rows.find((r) => r.id === args.resumeId)
      : rows.find((r) => r.workspace === boot.controller.ws.root);
    if (!wanted) {
      process.stderr.write(
        args.resumeId
          ? `vinax: no session called ${args.resumeId}. Run vinax sessions to see the list.\n`
          : 'vinax: no earlier session for this directory.\n',
      );
      return EXIT.usage;
    }
    await boot.controller.resume(wanted.id);
    if (args.output === 'interactive') {
      process.stdout.write(`Resumed session ${wanted.id} (${wanted.messages} messages).\n\n`);
    }
  }

  if (args.prompt) {
    return runOnce(boot, args.prompt, args.output === 'json');
  }

  if (args.output !== 'interactive' || !process.stdin.isTTY) {
    process.stderr.write(
      'vinax: nothing to do — there is no terminal to read from.\nGive a request with -p "…", or run vinax from an interactive shell.\n',
    );
    return EXIT.usage;
  }

  return runInteractive(boot);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    const debug = process.argv.includes('--debug') || process.env.VINAX_DEBUG === '1';
    const message = e instanceof Error ? e.message : String(e);
    // A stack trace is a debugging tool, not an error message. --debug asks
    // for one; without it the user gets the sentence that tells them what to do.
    process.stderr.write(`vinax: ${message}\n`);
    if (debug && e instanceof Error && e.stack) process.stderr.write(`${e.stack}\n`);
    process.exitCode = EXIT.failure;
  })
  .finally(() => {
    killAllChildren();
  });
